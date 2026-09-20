import { createHash } from 'node:crypto';
import { env } from '@indexpilot/config';
import {
  AuditActions,
  Prisma,
  prisma,
  purchaseCredits,
  recordAudit,
  type Payment,
} from '@indexpilot/db';
import { createPaymentProvider } from '@indexpilot/providers';
import {
  badRequest,
  notFound,
  type CreditPackageItem,
  type SessionUser,
} from '@indexpilot/shared';
import { logger } from '../lib/logger.js';

export async function listPackages(): Promise<CreditPackageItem[]> {
  const packages = await prisma.creditPackage.findMany({
    where: { enabled: true },
    orderBy: { sortOrder: 'asc' },
  });
  return packages.map((pkg) => ({
    id: pkg.id,
    name: pkg.name,
    credits: pkg.credits,
    priceCents: pkg.priceCents,
    currency: pkg.currency,
    enabled: pkg.enabled,
    sortOrder: pkg.sortOrder,
  }));
}

export async function startCheckout(
  user: SessionUser,
  packageId: string,
): Promise<{ paymentId: string; checkoutUrl: string }> {
  const pkg = await prisma.creditPackage.findUnique({ where: { id: packageId } });
  if (!pkg || !pkg.enabled) throw notFound('Credit package not found.');

  const provider = createPaymentProvider();
  const payment = await prisma.payment.create({
    data: {
      userId: user.id,
      packageId: pkg.id,
      provider: provider.key,
      status: 'PENDING',
      amountCents: pkg.priceCents,
      currency: pkg.currency,
      credits: pkg.credits,
    },
  });

  const checkout = await provider.createCheckout({
    userId: user.id,
    userEmail: user.email,
    paymentId: payment.id,
    packageName: pkg.name,
    credits: pkg.credits,
    amountCents: pkg.priceCents,
    currency: pkg.currency,
    successUrl: new URL('/billing?status=success', env.APP_URL).toString(),
    cancelUrl: new URL('/billing?status=cancelled', env.APP_URL).toString(),
  });

  await prisma.payment.update({
    where: { id: payment.id },
    data: { providerPaymentId: checkout.providerPaymentId, checkoutUrl: checkout.checkoutUrl },
  });

  return { paymentId: payment.id, checkoutUrl: checkout.checkoutUrl };
}

export interface WebhookOutcome {
  handled: boolean;
  duplicate: boolean;
  paymentId: string | null;
  creditsAdded: number;
}

/**
 * Processes a verified payment webhook.
 *
 * Two independent idempotency guards:
 *  1. PaymentEvent has a unique (provider, providerEventId), so a replayed
 *     delivery short-circuits before any credit is granted.
 *  2. The ledger movement is keyed on the payment id, so even a *different*
 *     event id describing the same payment cannot credit the wallet twice.
 */
export async function handlePaymentWebhook(
  rawBody: string,
  headers: Record<string, string | undefined>,
): Promise<WebhookOutcome> {
  const provider = createPaymentProvider();
  const event = await provider.verifyWebhook(rawBody, headers);

  const payloadHash = createHash('sha256').update(rawBody).digest('hex');

  try {
    await prisma.paymentEvent.create({
      data: {
        provider: provider.key,
        providerEventId: event.providerEventId,
        type: event.type,
        payloadHash,
        metadata: { providerPaymentId: event.providerPaymentId } as Prisma.InputJsonObject,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      logger.info({ providerEventId: event.providerEventId }, 'duplicate payment webhook ignored');
      return { handled: true, duplicate: true, paymentId: null, creditsAdded: 0 };
    }
    throw error;
  }

  if (event.type === 'ignored') {
    return { handled: true, duplicate: false, paymentId: null, creditsAdded: 0 };
  }

  const payment = await findPayment(event.paymentId, event.providerPaymentId, provider.key);
  if (!payment) {
    logger.warn({ event: event.providerEventId }, 'webhook references an unknown payment');
    return { handled: false, duplicate: false, paymentId: null, creditsAdded: 0 };
  }

  await prisma.paymentEvent.updateMany({
    where: { provider: provider.key, providerEventId: event.providerEventId },
    data: { paymentId: payment.id },
  });

  if (event.type === 'payment.failed') {
    await prisma.payment.update({ where: { id: payment.id }, data: { status: 'FAILED' } });
    return { handled: true, duplicate: false, paymentId: payment.id, creditsAdded: 0 };
  }

  if (event.type === 'payment.refunded') {
    await prisma.payment.update({ where: { id: payment.id }, data: { status: 'REFUNDED' } });
    await recordAudit({
      actorUserId: payment.userId,
      action: AuditActions.paymentRefunded,
      entityType: 'payment',
      entityId: payment.id,
    });
    return { handled: true, duplicate: false, paymentId: payment.id, creditsAdded: 0 };
  }

  const movement = await purchaseCredits({
    userId: payment.userId,
    amount: payment.credits,
    referenceType: 'payment',
    referenceId: payment.id,
    description: `Credit purchase (${payment.credits} credits)`,
  });

  await prisma.payment.update({ where: { id: payment.id }, data: { status: 'SUCCEEDED' } });
  await recordAudit({
    actorUserId: payment.userId,
    action: AuditActions.paymentSucceeded,
    entityType: 'payment',
    entityId: payment.id,
    metadata: { credits: payment.credits, replayed: movement.replayed },
  });

  return {
    handled: true,
    duplicate: movement.replayed,
    paymentId: payment.id,
    creditsAdded: movement.replayed ? 0 : payment.credits,
  };
}

async function findPayment(
  paymentId: string | null,
  providerPaymentId: string | null,
  providerKey: string,
): Promise<Payment | null> {
  if (paymentId) {
    const byId = await prisma.payment.findUnique({ where: { id: paymentId } });
    if (byId) return byId;
  }
  if (providerPaymentId) {
    return prisma.payment.findFirst({
      where: { provider: providerKey, providerPaymentId },
    });
  }
  return null;
}

export async function listPayments(user: SessionUser, limit = 25) {
  const payments = await prisma.payment.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    take: Math.min(limit, 100),
    include: { creditPackage: { select: { name: true } } },
  });
  return payments.map((payment) => ({
    id: payment.id,
    status: payment.status,
    amountCents: payment.amountCents,
    currency: payment.currency,
    credits: payment.credits,
    packageName: payment.creditPackage?.name ?? null,
    checkoutUrl: payment.status === 'PENDING' ? payment.checkoutUrl : null,
    createdAt: payment.createdAt.toISOString(),
  }));
}

/**
 * Development-only helper used by the mock checkout page to emit a correctly
 * signed webhook without an external service.
 */
export async function simulateMockPayment(paymentId: string): Promise<WebhookOutcome> {
  if (env.PAYMENT_DRIVER !== 'mock') {
    throw badRequest('Mock payment confirmation is only available with PAYMENT_DRIVER=mock.');
  }
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment) throw notFound('Payment not found.');

  const body = JSON.stringify({
    id: `evt_mock_${payment.id}`,
    type: 'payment.succeeded',
    paymentId: payment.id,
    providerPaymentId: payment.providerPaymentId,
    amountCents: payment.amountCents,
    currency: payment.currency,
  });
  const provider = createPaymentProvider() as { sign?: (body: string) => string };
  const signature = provider.sign?.(body) ?? '';
  return handlePaymentWebhook(body, { 'x-mock-signature': signature });
}
