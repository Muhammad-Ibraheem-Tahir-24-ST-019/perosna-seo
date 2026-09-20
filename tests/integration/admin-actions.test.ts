import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MockPaymentProvider } from '../../packages/providers/src/payments/providers.js';
import { infrastructureAvailable, makeAdmin, prisma, registerClient } from './helpers.js';

const available = await infrastructureAvailable();

/** Covers the admin powers beyond read-only listing: money, roles and content. */
describe.skipIf(!available)('admin actions', () => {
  let app: FastifyInstance;
  const userIds: string[] = [];
  const packageIds: string[] = [];

  beforeAll(async () => {
    const { buildServer } = await import('../../apps/api/src/server.js');
    app = await buildServer();
    await app.ready();
  });

  afterAll(async () => {
    await prisma.creditPackage.deleteMany({ where: { id: { in: packageIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app.close();
    const { closeQueues } = await import('../../apps/api/src/lib/queue.js');
    await closeQueues();
  });

  async function newUser() {
    const result = await registerClient(app);
    userIds.push(result.userId);
    return result;
  }

  async function newSuperAdmin() {
    const result = await newUser();
    await prisma.user.update({ where: { id: result.userId }, data: { role: 'SUPER_ADMIN' } });
    return result;
  }

  // -------------------------------------------------------------------------
  describe('free credits', () => {
    it('grants credits to a customer and records the ledger movement', async () => {
      const admin = await newUser();
      await makeAdmin(admin.userId);
      const customer = await newUser();

      const response = await admin.client.request({
        method: 'POST',
        url: `/api/v1/admin/users/${customer.userId}/credits`,
        payload: { amount: 2_500, reason: 'Launch promotion - free credits' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().balance).toBe(2_550); // 50 signup bonus + 2500

      const wallet = await prisma.creditWallet.findUniqueOrThrow({
        where: { userId: customer.userId },
      });
      const movement = await prisma.creditTransaction.findFirst({
        where: { walletId: wallet.id, type: 'ADMIN_ADJUSTMENT' },
      });
      expect(movement?.amount).toBe(2_500);
      expect(movement?.description).toContain('Launch promotion');
    });

    it('can also take credits away, but never below zero', async () => {
      const admin = await newUser();
      await makeAdmin(admin.userId);
      const customer = await newUser();

      const ok = await admin.client.request({
        method: 'POST',
        url: `/api/v1/admin/users/${customer.userId}/credits`,
        payload: { amount: -20, reason: 'Correcting a duplicate grant' },
      });
      expect(ok.json().balance).toBe(30);

      const tooMuch = await admin.client.request({
        method: 'POST',
        url: `/api/v1/admin/users/${customer.userId}/credits`,
        payload: { amount: -1_000, reason: 'Should not be possible' },
      });
      expect(tooMuch.statusCode).toBe(402);
    });
  });

  // -------------------------------------------------------------------------
  describe('roles', () => {
    it('lets a super admin promote and demote, with an audit trail', async () => {
      const superAdmin = await newSuperAdmin();
      const customer = await newUser();

      const promote = await superAdmin.client.request({
        method: 'PATCH',
        url: `/api/v1/admin/users/${customer.userId}/role`,
        payload: { role: 'ADMIN', reason: 'Joining the support team' },
      });
      expect(promote.statusCode).toBe(200);
      expect(promote.json().role).toBe('ADMIN');

      const audit = await prisma.auditLog.findFirst({
        where: { action: 'admin.role_changed', entityId: customer.userId },
      });
      expect(audit?.reason).toBe('Joining the support team');

      const demote = await superAdmin.client.request({
        method: 'PATCH',
        url: `/api/v1/admin/users/${customer.userId}/role`,
        payload: { role: 'USER', reason: 'Left the support team' },
      });
      expect(demote.json().role).toBe('USER');
    });

    it('refuses role changes from a plain admin and refuses self-demotion', async () => {
      const plainAdmin = await newUser();
      await makeAdmin(plainAdmin.userId);
      const customer = await newUser();

      const forbidden = await plainAdmin.client.request({
        method: 'PATCH',
        url: `/api/v1/admin/users/${customer.userId}/role`,
        payload: { role: 'ADMIN', reason: 'Trying to escalate' },
      });
      expect(forbidden.statusCode).toBe(403);

      const superAdmin = await newSuperAdmin();
      const self = await superAdmin.client.request({
        method: 'PATCH',
        url: `/api/v1/admin/users/${superAdmin.userId}/role`,
        payload: { role: 'USER', reason: 'Locking myself out' },
      });
      expect(self.statusCode).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  describe('password reset', () => {
    it('sends a reset link and revokes the customer sessions', async () => {
      const admin = await newUser();
      await makeAdmin(admin.userId);
      const customer = await newUser();

      const response = await admin.client.request({
        method: 'POST',
        url: `/api/v1/admin/users/${customer.userId}/password-reset`,
        payload: { reason: 'Customer reported a compromised mailbox' },
      });
      expect(response.statusCode).toBe(200);

      // The customer's existing session must stop working immediately.
      const me = await customer.client.request({ method: 'GET', url: '/api/v1/auth/me' });
      expect(me.statusCode).toBe(401);
    });
  });

  // -------------------------------------------------------------------------
  describe('credit packages', () => {
    it('creates, edits, hides and deletes a package', async () => {
      const admin = await newUser();
      await makeAdmin(admin.userId);

      const created = await admin.client.request({
        method: 'POST',
        url: '/api/v1/admin/credit-packages',
        payload: { name: `Test pack ${randomUUID().slice(0, 6)}`, credits: 1_000, priceCents: 4900 },
      });
      expect(created.statusCode).toBe(201);
      const pkg = created.json().package;
      packageIds.push(pkg.id);

      const updated = await admin.client.request({
        method: 'PATCH',
        url: `/api/v1/admin/credit-packages/${pkg.id}`,
        payload: { priceCents: 3900, enabled: false },
      });
      expect(updated.json().package.priceCents).toBe(3900);

      // A hidden package disappears from the customer-facing list.
      const customer = await newUser();
      const visible = await customer.client.request({ method: 'GET', url: '/api/v1/billing/packages' });
      expect(visible.json().items.map((p: { id: string }) => p.id)).not.toContain(pkg.id);

      const deleted = await admin.client.request({
        method: 'DELETE',
        url: `/api/v1/admin/credit-packages/${pkg.id}`,
      });
      expect(deleted.json().deleted).toBe(true);
    });

    it('retires rather than deletes a package that has been sold', async () => {
      const admin = await newUser();
      await makeAdmin(admin.userId);
      const customer = await newUser();

      const created = await admin.client.request({
        method: 'POST',
        url: '/api/v1/admin/credit-packages',
        payload: { name: `Sold pack ${randomUUID().slice(0, 6)}`, credits: 100, priceCents: 900 },
      });
      const pkg = created.json().package;
      packageIds.push(pkg.id);

      await customer.client.request({
        method: 'POST',
        url: '/api/v1/billing/checkout',
        payload: { packageId: pkg.id },
      });

      const removed = await admin.client.request({
        method: 'DELETE',
        url: `/api/v1/admin/credit-packages/${pkg.id}`,
      });
      expect(removed.json()).toMatchObject({ deleted: false, disabled: true });

      // History still resolves.
      const still = await prisma.creditPackage.findUnique({ where: { id: pkg.id } });
      expect(still?.enabled).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  describe('refunds', () => {
    async function paidCustomer() {
      const customer = await newUser();
      const packages = await customer.client.request({
        method: 'GET',
        url: '/api/v1/billing/packages',
      });
      const pkg = packages.json().items[0];
      const checkout = await customer.client.request({
        method: 'POST',
        url: '/api/v1/billing/checkout',
        payload: { packageId: pkg.id },
      });
      const { paymentId } = checkout.json();

      const provider = new MockPaymentProvider({
        webhookSecret: process.env['PAYMENT_WEBHOOK_SECRET'] ?? 'dev-webhook-secret',
        appUrl: 'http://localhost:3000',
      });
      const body = JSON.stringify({
        id: `evt_${randomUUID()}`,
        type: 'payment.succeeded',
        paymentId,
        amountCents: pkg.priceCents,
        currency: 'USD',
      });
      await app.inject({
        method: 'POST',
        url: '/api/v1/webhooks/payments',
        payload: body,
        headers: { 'content-type': 'application/json', 'x-mock-signature': provider.sign(body) },
      });
      return { customer, paymentId, credits: pkg.credits as number };
    }

    it('refunds a payment and claws back the credits exactly once', async () => {
      const admin = await newUser();
      await makeAdmin(admin.userId);
      const { customer, paymentId, credits } = await paidCustomer();

      const before = await prisma.creditWallet.findUniqueOrThrow({
        where: { userId: customer.userId },
      });
      expect(before.cachedBalance).toBe(50 + credits);

      const refund = await admin.client.request({
        method: 'POST',
        url: `/api/v1/admin/payments/${paymentId}/refund`,
        payload: { reason: 'Customer requested a refund' },
      });
      expect(refund.statusCode).toBe(200);
      expect(refund.json().creditsReversed).toBe(credits);

      const after = await prisma.creditWallet.findUniqueOrThrow({
        where: { userId: customer.userId },
      });
      expect(after.cachedBalance).toBe(50);

      const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
      expect(payment.status).toBe('REFUNDED');

      // A second refund attempt must not double-reverse.
      const again = await admin.client.request({
        method: 'POST',
        url: `/api/v1/admin/payments/${paymentId}/refund`,
        payload: { reason: 'Double click' },
      });
      expect(again.statusCode).toBe(400);
      const unchanged = await prisma.creditWallet.findUniqueOrThrow({
        where: { userId: customer.userId },
      });
      expect(unchanged.cachedBalance).toBe(50);
    });

    it('refuses to reverse credits the customer already spent unless confirmed', async () => {
      const admin = await newUser();
      await makeAdmin(admin.userId);
      const { customer, paymentId } = await paidCustomer();

      // Spend everything.
      const wallet = await prisma.creditWallet.findUniqueOrThrow({
        where: { userId: customer.userId },
      });
      await prisma.$transaction([
        prisma.creditWallet.update({ where: { id: wallet.id }, data: { cachedBalance: 0 } }),
        prisma.creditTransaction.create({
          data: {
            walletId: wallet.id,
            amount: -wallet.cachedBalance,
            type: 'SUBMISSION_DEBIT',
            referenceType: 'test',
            referenceId: randomUUID(),
            balanceAfter: 0,
          },
        }),
      ]);

      const blocked = await admin.client.request({
        method: 'POST',
        url: `/api/v1/admin/payments/${paymentId}/refund`,
        payload: { reason: 'Chargeback' },
      });
      expect(blocked.statusCode).toBe(409);
      expect(blocked.json().error.code).toBe('CONFLICT');

      const confirmed = await admin.client.request({
        method: 'POST',
        url: `/api/v1/admin/payments/${paymentId}/refund`,
        payload: { reason: 'Chargeback', allowPartial: true },
      });
      expect(confirmed.statusCode).toBe(200);
      expect(confirmed.json().partial).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  describe('operations', () => {
    it('requeues a URL through the pipeline', async () => {
      const admin = await newUser();
      await makeAdmin(admin.userId);
      const customer = await newUser();

      const project = await customer.client.request({
        method: 'POST',
        url: '/api/v1/projects',
        payload: { name: `Requeue ${randomUUID().slice(0, 6)}` },
      });
      const projectId = project.json().project.id;
      await customer.client.request({
        method: 'POST',
        url: `/api/v1/projects/${projectId}/urls`,
        payload: { urls: 'https://example.com/admin-requeue' },
      });
      const url = await prisma.urlRecord.findFirstOrThrow({ where: { projectId } });
      await prisma.urlRecord.update({
        where: { id: url.id },
        data: { validationStatus: 'INVALID', processingStatus: 'FAILED' },
      });

      const response = await admin.client.request({
        method: 'POST',
        url: `/api/v1/admin/urls/${url.id}/requeue`,
      });
      expect(response.statusCode).toBe(200);

      const reset = await prisma.urlRecord.findUniqueOrThrow({ where: { id: url.id } });
      expect(reset.validationStatus).toBe('RECEIVED');
      expect(reset.processingStatus).toBe('NOT_QUEUED');
    });

    it('stores provider credentials encrypted and never returns them', async () => {
      const superAdmin = await newSuperAdmin();
      const provider = await prisma.discoveryProviderConfig.findFirstOrThrow();

      const response = await superAdmin.client.request({
        method: 'PUT',
        url: `/api/v1/admin/providers/${provider.id}/credentials`,
        payload: { settings: { key: 'super-secret-provider-key' } },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().hasCredentials).toBe(true);

      const stored = await prisma.discoveryProviderConfig.findUniqueOrThrow({
        where: { id: provider.id },
      });
      expect(stored.encryptedConfig).not.toContain('super-secret-provider-key');

      const listed = await superAdmin.client.request({
        method: 'GET',
        url: '/api/v1/admin/providers',
      });
      expect(listed.body).not.toContain('super-secret-provider-key');
      expect(listed.body).not.toContain('encryptedConfig');

      // The audit log records which keys were set, never their values.
      const audit = await prisma.auditLog.findFirst({
        where: { action: 'admin.provider_credentials_set', entityId: provider.id },
      });
      expect(JSON.stringify(audit?.metadata)).not.toContain('super-secret-provider-key');

      await prisma.discoveryProviderConfig.update({
        where: { id: provider.id },
        data: { encryptedConfig: null },
      });
    });
  });
});
