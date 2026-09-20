import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MockPaymentProvider } from '../../packages/providers/src/payments/providers.js';
import {
  createClient,
  infrastructureAvailable,
  makeAdmin,
  prisma,
  registerClient,
  uniqueEmail,
} from './helpers.js';

const available = await infrastructureAvailable();

describe.skipIf(!available)('REST API (PostgreSQL + Redis)', () => {
  let app: FastifyInstance;
  const userIds: string[] = [];

  beforeAll(async () => {
    const { buildServer } = await import('../../apps/api/src/server.js');
    app = await buildServer();
    await app.ready();
  });

  afterAll(async () => {
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

  async function createProject(client: Awaited<ReturnType<typeof newUser>>['client'], name?: string) {
    const response = await client.request({
      method: 'POST',
      url: '/api/v1/projects',
      payload: { name: name ?? `Project ${randomUUID().slice(0, 6)}` },
    });
    expect(response.statusCode).toBe(201);
    return response.json().project as { id: string; name: string };
  }

  // -------------------------------------------------------------------------
  describe('health', () => {
    it('reports liveness and readiness', async () => {
      const live = await app.inject({ method: 'GET', url: '/health/live' });
      expect(live.statusCode).toBe(200);
      const ready = await app.inject({ method: 'GET', url: '/health/ready' });
      expect(ready.statusCode).toBe(200);
      expect(ready.json().checks.map((check: { name: string }) => check.name)).toEqual([
        'database',
        'redis',
      ]);
      // Never leaks connection strings.
      expect(ready.body).not.toContain('postgresql://');
    });
  });

  // -------------------------------------------------------------------------
  describe('authentication', () => {
    it('rejects anonymous access with the standard error envelope', async () => {
      const response = await app.inject({ method: 'GET', url: '/api/v1/auth/me' });
      expect(response.statusCode).toBe(401);
      const body = response.json();
      expect(body.error.code).toBe('UNAUTHORIZED');
      expect(body.error.requestId).toBeTruthy();
    });

    it('rate limits repeated signups from one IP', async () => {
      const ip = '198.51.100.7';
      const attempts = await Promise.all(
        Array.from({ length: 14 }, () =>
          app.inject({
            method: 'POST',
            url: '/api/v1/auth/register',
            remoteAddress: ip,
            payload: { email: uniqueEmail('flood'), password: 'Flood-pass-123' },
          }),
        ),
      );
      const created = attempts.filter((response) => response.statusCode === 201);
      for (const response of created) userIds.push(response.json().user.id as string);

      expect(created.length).toBeLessThanOrEqual(10);
      expect(attempts.some((response) => response.statusCode === 429)).toBe(true);
    });

    it('registers with an http-only session cookie and welcome credits', async () => {
      const client = createClient(app);
      const email = uniqueEmail('reg');
      const response = await client.request({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: { email, password: 'Register-pass-123' },
      });
      expect(response.statusCode).toBe(201);
      const user = response.json().user;
      userIds.push(user.id);
      expect(user.credits).toBe(50);
      expect(user).not.toHaveProperty('passwordHash');

      const session = response.cookies.find((cookie) => cookie.name === 'ip_session');
      expect(session?.httpOnly).toBe(true);
      expect(session?.sameSite?.toLowerCase()).toBe('lax');

      const me = await client.request({ method: 'GET', url: '/api/v1/auth/me' });
      expect(me.statusCode).toBe(200);
      expect(me.json().user.email).toBe(email);
    });

    it('rejects weak passwords and duplicate emails', async () => {
      const weak = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: { email: uniqueEmail('weak'), password: 'short' },
      });
      expect(weak.statusCode).toBe(422);

      const { email } = await newUser();
      const duplicate = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: { email, password: 'Another-pass-123' },
      });
      expect(duplicate.statusCode).toBe(409);
    });

    it('uses one generic message for unknown email and wrong password', async () => {
      const { email } = await newUser();
      const wrong = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email, password: 'Wrong-pass-123' },
      });
      const unknown = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: uniqueEmail('nobody'), password: 'Wrong-pass-123' },
      });
      expect(wrong.statusCode).toBe(401);
      expect(unknown.statusCode).toBe(401);
      expect(wrong.json().error.message).toBe(unknown.json().error.message);
    });

    it('logs out and revokes the session server-side', async () => {
      const { client } = await newUser();
      const stolenCookies = { ...client.cookies };
      const logout = await client.request({ method: 'POST', url: '/api/v1/auth/logout' });
      expect(logout.statusCode).toBe(200);

      const replay = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: {
          cookie: Object.entries(stolenCookies)
            .map(([name, value]) => `${name}=${value}`)
            .join('; '),
        },
      });
      expect(replay.statusCode).toBe(401);
    });

    it('does not reveal whether an email exists on password reset', async () => {
      const { email } = await newUser();
      const known = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/forgot-password',
        payload: { email },
      });
      const unknown = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/forgot-password',
        payload: { email: uniqueEmail('ghost') },
      });
      expect(known.statusCode).toBe(200);
      expect(known.body).toBe(unknown.body);
    });
  });

  // -------------------------------------------------------------------------
  describe('CSRF', () => {
    it('refuses a cookie-authenticated write without the CSRF header', async () => {
      const { client } = await newUser();
      const response = await client.request({
        method: 'POST',
        url: '/api/v1/projects',
        payload: { name: 'No CSRF' },
        withCsrf: false,
      });
      expect(response.statusCode).toBe(403);
    });

    it('refuses a mismatched CSRF header', async () => {
      const { client } = await newUser();
      const response = await client.request({
        method: 'POST',
        url: '/api/v1/projects',
        payload: { name: 'Bad CSRF' },
        withCsrf: false,
        headers: { 'x-csrf-token': 'forged-token-value' },
      });
      expect(response.statusCode).toBe(403);
    });
  });

  // -------------------------------------------------------------------------
  describe('projects and submissions', () => {
    it('creates projects and rejects duplicate active names', async () => {
      const { client } = await newUser();
      const project = await createProject(client, 'Guest Posts');
      expect(project.name).toBe('Guest Posts');
      const duplicate = await client.request({
        method: 'POST',
        url: '/api/v1/projects',
        payload: { name: 'Guest Posts' },
      });
      expect(duplicate.statusCode).toBe(409);
    });

    it('accepts a bulk paste, deduplicates, rejects malformed URLs and charges exactly', async () => {
      const { client, userId } = await newUser();
      const project = await createProject(client);

      const response = await client.request({
        method: 'POST',
        url: `/api/v1/projects/${project.id}/urls`,
        payload: {
          urls: [
            'https://example.com/a',
            'https://example.com/a#duplicate',
            'https://example.com/b',
            'javascript:alert(1)',
            'not a url',
          ].join('\n'),
        },
      });
      expect(response.statusCode).toBe(202);
      const result = response.json();
      expect(result).toMatchObject({
        accepted: 2,
        duplicatesInPayload: 1,
        invalid: 2,
        creditsCharged: 2,
        creditsRemaining: 48,
      });

      const rows = await prisma.urlRecord.count({ where: { projectId: project.id } });
      expect(rows).toBe(2);
      const wallet = await prisma.creditWallet.findUniqueOrThrow({ where: { userId } });
      expect(wallet.cachedBalance).toBe(48);
    });

    it('does not charge again for URLs the project already tracks', async () => {
      const { client } = await newUser();
      const project = await createProject(client);
      const payload = { urls: 'https://example.com/x\nhttps://example.com/y' };

      await client.request({ method: 'POST', url: `/api/v1/projects/${project.id}/urls`, payload });
      const second = await client.request({
        method: 'POST',
        url: `/api/v1/projects/${project.id}/urls`,
        payload: { urls: 'https://example.com/x\nhttps://example.com/z' },
      });
      expect(second.json()).toMatchObject({
        accepted: 1,
        duplicatesInProject: 1,
        creditsCharged: 1,
      });
    });

    it('replays an idempotent submission instead of charging twice', async () => {
      const { client, userId } = await newUser();
      const project = await createProject(client);
      const key = randomUUID();
      const request = () =>
        client.request({
          method: 'POST',
          url: `/api/v1/projects/${project.id}/urls`,
          payload: { urls: 'https://example.com/idem-1\nhttps://example.com/idem-2' },
          headers: { 'idempotency-key': key },
        });

      const first = await request();
      const second = await request();
      expect(first.statusCode).toBe(202);
      expect(second.json().batchId).toBe(first.json().batchId);

      const wallet = await prisma.creditWallet.findUniqueOrThrow({ where: { userId } });
      expect(wallet.cachedBalance).toBe(48);
      const batches = await prisma.submissionBatch.count({ where: { projectId: project.id } });
      expect(batches).toBe(1);
    });

    it('refuses a submission that exceeds the balance and creates nothing', async () => {
      const { client } = await newUser();
      const project = await createProject(client);
      const urls = Array.from({ length: 60 }, (_, index) => `https://example.com/p/${index}`).join(
        '\n',
      );
      const response = await client.request({
        method: 'POST',
        url: `/api/v1/projects/${project.id}/urls`,
        payload: { urls },
      });
      expect(response.statusCode).toBe(402);
      expect(response.json().error.code).toBe('INSUFFICIENT_CREDITS');
      expect(await prisma.urlRecord.count({ where: { projectId: project.id } })).toBe(0);
      expect(await prisma.submissionBatch.count({ where: { projectId: project.id } })).toBe(0);
    });

    it('actually enqueues a validation job for every accepted URL', async () => {
      const { client } = await newUser();
      const project = await createProject(client);
      const response = await client.request({
        method: 'POST',
        url: `/api/v1/projects/${project.id}/urls`,
        payload: { urls: 'https://example.com/queued-1\nhttps://example.com/queued-2' },
      });
      expect(response.json().accepted).toBe(2);

      const { getQueue } = await import('../../apps/api/src/lib/queue.js');
      const { jobIds, QUEUE_NAMES } = await import('../../packages/shared/src/constants.js');
      const queue = getQueue(QUEUE_NAMES.urlValidation);
      const urls = await prisma.urlRecord.findMany({
        where: { projectId: project.id },
        select: { id: true },
      });

      for (const url of urls) {
        const job = await queue.getJob(jobIds.validateUrl(url.id));
        expect(job, `no validation job for ${url.id}`).toBeTruthy();
        expect(job?.data.urlId).toBe(url.id);
        await job?.remove().catch(() => undefined);
      }
    });

    it('previews cost without charging', async () => {
      const { client, userId } = await newUser();
      const project = await createProject(client);
      const response = await client.request({
        method: 'POST',
        url: `/api/v1/projects/${project.id}/urls/preview`,
        payload: { urls: 'https://example.com/1\nhttps://example.com/2\nftp://nope' },
      });
      expect(response.json()).toMatchObject({ accepted: 2, invalid: 1, estimatedCredits: 2 });
      const wallet = await prisma.creditWallet.findUniqueOrThrow({ where: { userId } });
      expect(wallet.cachedBalance).toBe(50);
    });

    it('accepts a TXT upload', async () => {
      const { client } = await newUser();
      const project = await createProject(client);
      const boundary = `----indexpilot${randomUUID().slice(0, 8)}`;
      const body = [
        `--${boundary}`,
        'Content-Disposition: form-data; name="file"; filename="urls.txt"',
        'Content-Type: text/plain',
        '',
        'https://example.com/upload-1\nhttps://example.com/upload-2\n',
        `--${boundary}--`,
        '',
      ].join('\r\n');

      const response = await client.request({
        method: 'POST',
        url: `/api/v1/projects/${project.id}/uploads`,
        payload: body,
        headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      });
      expect(response.statusCode).toBe(202);
      expect(response.json().accepted).toBe(2);
    });

    it('rejects uploads with a disallowed extension', async () => {
      const { client } = await newUser();
      const project = await createProject(client);
      const boundary = `----indexpilot${randomUUID().slice(0, 8)}`;
      const body = [
        `--${boundary}`,
        'Content-Disposition: form-data; name="file"; filename="evil.exe"',
        'Content-Type: text/plain',
        '',
        'https://example.com/',
        `--${boundary}--`,
        '',
      ].join('\r\n');
      const response = await client.request({
        method: 'POST',
        url: `/api/v1/projects/${project.id}/uploads`,
        payload: body,
        headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      });
      expect(response.statusCode).toBe(400);
    });

    it('paginates URL lists with a stable cursor', async () => {
      const { client } = await newUser();
      const project = await createProject(client);
      await client.request({
        method: 'POST',
        url: `/api/v1/projects/${project.id}/urls`,
        payload: {
          urls: Array.from({ length: 5 }, (_, index) => `https://example.com/page/${index}`).join(
            '\n',
          ),
        },
      });
      const first = await client.request({
        method: 'GET',
        url: `/api/v1/projects/${project.id}/urls?limit=3`,
      });
      const firstPage = first.json();
      expect(firstPage.items).toHaveLength(3);
      expect(firstPage.nextCursor).toBeTruthy();

      const second = await client.request({
        method: 'GET',
        url: `/api/v1/projects/${project.id}/urls?limit=3&cursor=${encodeURIComponent(firstPage.nextCursor)}`,
      });
      const secondPage = second.json();
      expect(secondPage.items).toHaveLength(2);
      expect(secondPage.nextCursor).toBeNull();
      const ids = new Set([...firstPage.items, ...secondPage.items].map((item: { id: string }) => item.id));
      expect(ids.size).toBe(5);
    });
  });

  // -------------------------------------------------------------------------
  describe('tenant isolation', () => {
    it('hides one customer’s projects and URLs from another', async () => {
      const alice = await newUser();
      const bob = await newUser();
      const project = await createProject(alice.client);
      await alice.client.request({
        method: 'POST',
        url: `/api/v1/projects/${project.id}/urls`,
        payload: { urls: 'https://example.com/alice-only' },
      });
      const url = await prisma.urlRecord.findFirstOrThrow({ where: { projectId: project.id } });

      expect(
        (await bob.client.request({ method: 'GET', url: `/api/v1/projects/${project.id}` }))
          .statusCode,
      ).toBe(404);
      expect(
        (await bob.client.request({ method: 'GET', url: `/api/v1/urls/${url.id}` })).statusCode,
      ).toBe(403);
      expect(
        (
          await bob.client.request({
            method: 'POST',
            url: `/api/v1/projects/${project.id}/urls`,
            payload: { urls: 'https://example.com/intrusion' },
          })
        ).statusCode,
      ).toBe(403);

      const bobList = await bob.client.request({ method: 'GET', url: '/api/v1/urls' });
      expect(bobList.json().items).toHaveLength(0);
    });

    it('lets two customers track the same public URL independently', async () => {
      const alice = await newUser();
      const bob = await newUser();
      const aliceProject = await createProject(alice.client);
      const bobProject = await createProject(bob.client);
      const payload = { urls: 'https://example.com/shared-backlink' };

      const a = await alice.client.request({
        method: 'POST',
        url: `/api/v1/projects/${aliceProject.id}/urls`,
        payload,
      });
      const b = await bob.client.request({
        method: 'POST',
        url: `/api/v1/projects/${bobProject.id}/urls`,
        payload,
      });
      expect(a.json().accepted).toBe(1);
      expect(b.json().accepted).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  describe('API keys', () => {
    it('shows the secret once, authenticates without CSRF, and stops working when revoked', async () => {
      const { client } = await newUser();
      const created = await client.request({
        method: 'POST',
        url: '/api/v1/api-keys',
        payload: { name: 'CI' },
      });
      expect(created.statusCode).toBe(201);
      const { secret, apiKey } = created.json();
      expect(secret).toMatch(/^ip_live_/);

      const stored = await prisma.apiKey.findUniqueOrThrow({ where: { id: apiKey.id } });
      expect(stored.keyHash).not.toBe(secret);
      expect(JSON.stringify(stored)).not.toContain(secret);

      const list = await client.request({ method: 'GET', url: '/api/v1/api-keys' });
      expect(list.body).not.toContain(secret);

      const bearer = { authorization: `Bearer ${secret}` };
      const project = await app.inject({
        method: 'POST',
        url: '/api/v1/projects',
        payload: { name: 'Created by API key' },
        headers: bearer,
      });
      expect(project.statusCode).toBe(201);

      const revoke = await client.request({ method: 'DELETE', url: `/api/v1/api-keys/${apiKey.id}` });
      expect(revoke.statusCode).toBe(200);

      const afterRevoke = await app.inject({
        method: 'GET',
        url: '/api/v1/projects',
        headers: bearer,
      });
      expect(afterRevoke.statusCode).toBe(401);
    });
  });

  // -------------------------------------------------------------------------
  describe('admin', () => {
    it('forbids customers from admin endpoints', async () => {
      const { client } = await newUser();
      const response = await client.request({ method: 'GET', url: '/api/v1/admin/overview' });
      expect(response.statusCode).toBe(403);
    });

    it('requires a reason for credit adjustments and audits them', async () => {
      const admin = await newUser();
      await makeAdmin(admin.userId);
      const customer = await newUser();

      const noReason = await admin.client.request({
        method: 'POST',
        url: `/api/v1/admin/users/${customer.userId}/credits`,
        payload: { amount: 100, reason: '' },
      });
      expect(noReason.statusCode).toBe(422);

      const adjusted = await admin.client.request({
        method: 'POST',
        url: `/api/v1/admin/users/${customer.userId}/credits`,
        payload: { amount: 100, reason: 'Goodwill credit after outage' },
      });
      expect(adjusted.statusCode).toBe(200);
      expect(adjusted.json().balance).toBe(150);

      const audit = await prisma.auditLog.findFirst({
        where: { action: 'admin.credits_adjusted', entityId: customer.userId },
      });
      expect(audit?.reason).toBe('Goodwill credit after outage');
      expect(audit?.actorUserId).toBe(admin.userId);

      const overview = await admin.client.request({ method: 'GET', url: '/api/v1/admin/overview' });
      expect(overview.statusCode).toBe(200);
      // Provider secrets never reach the browser, even for admins.
      expect(overview.body).not.toContain('encryptedConfig');
    });

    it('suspends an account and revokes its sessions', async () => {
      const admin = await newUser();
      await makeAdmin(admin.userId);
      const customer = await newUser();

      const response = await admin.client.request({
        method: 'POST',
        url: `/api/v1/admin/users/${customer.userId}/suspension`,
        payload: { suspended: true, reason: 'Abuse report #42' },
      });
      expect(response.statusCode).toBe(200);

      const me = await customer.client.request({ method: 'GET', url: '/api/v1/auth/me' });
      expect(me.statusCode).toBe(401);
    });
  });

  // -------------------------------------------------------------------------
  describe('payments', () => {
    it('credits a verified webhook exactly once and rejects forged ones', async () => {
      const { client, userId } = await newUser();
      const packages = await client.request({ method: 'GET', url: '/api/v1/billing/packages' });
      const pkg = packages.json().items[0];
      expect(pkg).toBeTruthy();

      const checkout = await client.request({
        method: 'POST',
        url: '/api/v1/billing/checkout',
        payload: { packageId: pkg.id },
      });
      expect(checkout.statusCode).toBe(200);
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

      const forged = await app.inject({
        method: 'POST',
        url: '/api/v1/webhooks/payments',
        payload: body,
        headers: { 'content-type': 'application/json', 'x-mock-signature': 'deadbeef' },
      });
      expect(forged.statusCode).toBe(401);

      const deliver = () =>
        app.inject({
          method: 'POST',
          url: '/api/v1/webhooks/payments',
          payload: body,
          headers: { 'content-type': 'application/json', 'x-mock-signature': provider.sign(body) },
        });

      const [first, second, third] = [await deliver(), await deliver(), await deliver()];
      expect(first.statusCode).toBe(200);
      expect(first.json().creditsAdded).toBe(pkg.credits);
      expect(second.json().duplicate).toBe(true);
      expect(third.json().duplicate).toBe(true);

      const wallet = await prisma.creditWallet.findUniqueOrThrow({ where: { userId } });
      expect(wallet.cachedBalance).toBe(50 + pkg.credits);
      const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
      expect(payment.status).toBe('SUCCEEDED');
    });
  });

  // -------------------------------------------------------------------------
  describe('reports and dashboard', () => {
    it('queues a CSV report and returns real dashboard totals', async () => {
      const { client } = await newUser();
      const project = await createProject(client);
      await client.request({
        method: 'POST',
        url: `/api/v1/projects/${project.id}/urls`,
        payload: { urls: 'https://example.com/r1\nhttps://example.com/r2\nhttps://example.com/r3' },
      });

      const report = await client.request({
        method: 'POST',
        url: '/api/v1/reports',
        payload: { projectId: project.id, filter: 'all' },
      });
      expect(report.statusCode).toBe(202);
      expect(report.json().report.status).toBe('QUEUED');

      const dashboard = await client.request({ method: 'GET', url: '/api/v1/dashboard' });
      expect(dashboard.statusCode).toBe(200);
      const totals = dashboard.json().totals;
      expect(totals.totalUrls).toBe(3);
      expect(totals.indexedConfirmed).toBe(0);
      expect(totals.credits).toBe(47);
    });
  });
});
