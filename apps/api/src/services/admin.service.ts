import {
  adjustCredits,
  AuditActions,
  getOrCreateWallet,
  type Prisma,
  prisma,
  recordAudit,
  reconcileWallet,
  reverseCredits,
} from '@indexpilot/db';
import { env } from '@indexpilot/config';
import { createPaymentProvider } from '@indexpilot/providers';
import { badRequest, conflict, encryptSecret, notFound, type SessionUser } from '@indexpilot/shared';
import { getQueueDepths } from '../lib/queue.js';
import { requestPasswordReset } from './auth.service.js';

export async function getAdminOverview() {
  const [users, urls, projects, failedUrls, payments, creditsOutstanding, queues, providers] =
    await Promise.all([
      prisma.user.groupBy({ by: ['status'], _count: { _all: true } }),
      prisma.urlRecord.count(),
      prisma.project.count(),
      prisma.urlRecord.count({ where: { processingStatus: 'FAILED' } }),
      prisma.payment.aggregate({
        where: { status: 'SUCCEEDED' },
        _sum: { amountCents: true },
        _count: { _all: true },
      }),
      prisma.creditWallet.aggregate({ _sum: { cachedBalance: true, lifetimeSpent: true } }),
      getQueueDepths().catch(() => []),
      prisma.discoveryProviderConfig.findMany({ orderBy: { priority: 'asc' } }),
    ]);

  return {
    users: {
      total: users.reduce((sum, row) => sum + row._count._all, 0),
      byStatus: Object.fromEntries(users.map((row) => [row.status, row._count._all])),
    },
    urls: { total: urls, failed: failedUrls },
    projects,
    payments: {
      count: payments._count._all,
      grossCents: payments._sum.amountCents ?? 0,
    },
    credits: {
      outstanding: creditsOutstanding._sum.cachedBalance ?? 0,
      lifetimeSpent: creditsOutstanding._sum.lifetimeSpent ?? 0,
    },
    queues,
    providers: providers.map((provider) => ({
      id: provider.id,
      key: provider.key,
      name: provider.name,
      type: provider.type,
      enabled: provider.enabled,
      priority: provider.priority,
      healthStatus: provider.healthStatus,
      healthDetail: provider.healthDetail,
      lastHealthCheckAt: provider.lastHealthCheckAt?.toISOString() ?? null,
      rateLimitPerMin: provider.rateLimitPerMin,
      dailyLimit: provider.dailyLimit,
    })),
  };
}

export async function listUsers(options: { search?: string; limit?: number; skip?: number }) {
  const where: Prisma.UserWhereInput = options.search
    ? { email: { contains: options.search, mode: 'insensitive' } }
    : {};
  const [rows, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Math.min(options.limit ?? 25, 100),
      skip: options.skip ?? 0,
      include: {
        wallet: { select: { cachedBalance: true, lifetimeSpent: true } },
        _count: { select: { projects: true, urls: true } },
      },
    }),
    prisma.user.count({ where }),
  ]);

  return {
    total,
    items: rows.map((user) => ({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      status: user.status,
      credits: user.wallet?.cachedBalance ?? 0,
      lifetimeSpent: user.wallet?.lifetimeSpent ?? 0,
      projects: user._count.projects,
      urls: user._count.urls,
      createdAt: user.createdAt.toISOString(),
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    })),
  };
}

export async function getUserDetail(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      wallet: true,
      projects: { orderBy: { createdAt: 'desc' }, take: 20 },
      payments: { orderBy: { createdAt: 'desc' }, take: 20 },
      apiKeys: { orderBy: { createdAt: 'desc' } },
    },
  });
  if (!user) throw notFound('User not found.');

  const wallet = await getOrCreateWallet(user.id);
  const [transactions, reconciliation] = await Promise.all([
    prisma.creditTransaction.findMany({
      where: { walletId: wallet.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
    reconcileWallet(user.id),
  ]);

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    status: user.status,
    suspendedReason: user.suspendedReason,
    createdAt: user.createdAt.toISOString(),
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    wallet: {
      balance: wallet.cachedBalance,
      lifetimeSpent: wallet.lifetimeSpent,
      reconciliation,
    },
    projects: user.projects.map((project) => ({
      id: project.id,
      name: project.name,
      status: project.status,
      createdAt: project.createdAt.toISOString(),
    })),
    payments: user.payments.map((payment) => ({
      id: payment.id,
      status: payment.status,
      amountCents: payment.amountCents,
      credits: payment.credits,
      createdAt: payment.createdAt.toISOString(),
    })),
    apiKeys: user.apiKeys.map((key) => ({
      id: key.id,
      name: key.name,
      keyPrefix: key.keyPrefix,
      revokedAt: key.revokedAt?.toISOString() ?? null,
      lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
    })),
    transactions: transactions.map((transaction) => ({
      id: transaction.id,
      amount: transaction.amount,
      type: transaction.type,
      description: transaction.description,
      referenceType: transaction.referenceType,
      referenceId: transaction.referenceId,
      balanceAfter: transaction.balanceAfter,
      createdAt: transaction.createdAt.toISOString(),
    })),
  };
}

export async function setUserSuspension(
  actor: SessionUser,
  userId: string,
  suspended: boolean,
  reason: string,
) {
  if (!reason.trim()) throw badRequest('A reason is required.');
  if (userId === actor.id) throw badRequest('You cannot suspend your own account.');

  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      status: suspended ? 'SUSPENDED' : 'ACTIVE',
      suspendedReason: suspended ? reason.trim() : null,
    },
  });
  if (suspended) {
    await prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
  await recordAudit({
    actorUserId: actor.id,
    actorEmail: actor.email,
    action: suspended ? AuditActions.userSuspended : AuditActions.userUnsuspended,
    entityType: 'user',
    entityId: userId,
    reason: reason.trim(),
  });
  return { id: user.id, status: user.status };
}

/**
 * Admin credit adjustment. The reason is mandatory and the movement is written
 * to both the ledger and the audit log.
 */
export async function adjustUserCredits(
  actor: SessionUser,
  userId: string,
  amount: number,
  reason: string,
) {
  if (!reason.trim()) throw badRequest('A reason is required for credit adjustments.');
  if (!Number.isInteger(amount) || amount === 0) {
    throw badRequest('Amount must be a non-zero integer.');
  }
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw notFound('User not found.');

  const adjustmentId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const movement = await adjustCredits({
    userId,
    amount,
    referenceType: 'admin_adjustment',
    referenceId: adjustmentId,
    description: reason.trim(),
  });

  await recordAudit({
    actorUserId: actor.id,
    actorEmail: actor.email,
    action: AuditActions.creditsAdjusted,
    entityType: 'user',
    entityId: userId,
    reason: reason.trim(),
    metadata: { amount, balanceAfter: movement.balance, adjustmentId },
  });

  return { balance: movement.balance, transactionId: movement.transaction.id };
}

/**
 * Role changes are restricted to SUPER_ADMIN (enforced at the route) and an
 * admin can never change their own role - that is how you end up with zero
 * administrators at 3am.
 */
export async function setUserRole(
  actor: SessionUser,
  userId: string,
  role: 'USER' | 'AGENCY' | 'ADMIN' | 'SUPER_ADMIN',
  reason: string,
) {
  if (!reason.trim()) throw badRequest('A reason is required.');
  if (userId === actor.id) throw badRequest('You cannot change your own role.');

  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target) throw notFound('User not found.');

  // Never remove the last super administrator.
  if (target.role === 'SUPER_ADMIN' && role !== 'SUPER_ADMIN') {
    const remaining = await prisma.user.count({
      where: { role: 'SUPER_ADMIN', id: { not: userId } },
    });
    if (remaining === 0) {
      throw badRequest('This is the last super administrator; promote someone else first.');
    }
  }

  const updated = await prisma.user.update({ where: { id: userId }, data: { role } });
  await recordAudit({
    actorUserId: actor.id,
    actorEmail: actor.email,
    action: AuditActions.roleChanged,
    entityType: 'user',
    entityId: userId,
    reason: reason.trim(),
    metadata: { from: target.role, to: role },
  });
  return { id: updated.id, role: updated.role };
}

/**
 * Refunds a payment at the provider and claws back the credits it granted.
 *
 * If the customer already spent them, the reversal is refused unless the admin
 * explicitly accepts a partial clawback - silently reversing "as much as fits"
 * would hide a real accounting decision.
 */
export async function refundPayment(
  actor: SessionUser,
  paymentId: string,
  reason: string,
  options: { allowPartial?: boolean } = {},
) {
  if (!reason.trim()) throw badRequest('A reason is required.');

  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment) throw notFound('Payment not found.');
  if (payment.status !== 'SUCCEEDED') {
    throw badRequest(`Only a succeeded payment can be refunded (this one is ${payment.status}).`);
  }

  const wallet = await getOrCreateWallet(payment.userId);
  const shortfall = payment.credits - wallet.cachedBalance;
  if (shortfall > 0 && !options.allowPartial) {
    throw conflict(
      `The customer has spent ${shortfall} of these credits. Confirm a partial clawback to continue.`,
      { granted: payment.credits, available: wallet.cachedBalance, shortfall },
    );
  }
  const reversibleCredits = Math.min(payment.credits, wallet.cachedBalance);

  const provider = createPaymentProvider();
  let providerRefunded = false;
  let providerError: string | null = null;
  if (payment.providerPaymentId) {
    try {
      const result = await provider.refund(payment.providerPaymentId, payment.amountCents);
      providerRefunded = result.refunded;
    } catch (error) {
      providerError = (error as Error).message;
    }
  }

  if (reversibleCredits > 0) {
    await reverseCredits({
      userId: payment.userId,
      amount: reversibleCredits,
      referenceType: 'payment',
      referenceId: payment.id,
      description: `Refund reversal: ${reason.trim()}`,
    });
  }

  await prisma.payment.update({ where: { id: payment.id }, data: { status: 'REFUNDED' } });
  await recordAudit({
    actorUserId: actor.id,
    actorEmail: actor.email,
    action: AuditActions.adminPaymentRefunded,
    entityType: 'payment',
    entityId: payment.id,
    reason: reason.trim(),
    metadata: {
      creditsGranted: payment.credits,
      creditsReversed: reversibleCredits,
      partial: reversibleCredits < payment.credits,
      providerRefunded,
      providerError,
    },
  });

  return {
    paymentId: payment.id,
    creditsReversed: reversibleCredits,
    partial: reversibleCredits < payment.credits,
    providerRefunded,
    providerError,
  };
}

/** Sends the customer a password reset link; never exposes or sets a password. */
export async function forcePasswordReset(actor: SessionUser, userId: string, reason: string) {
  if (!reason.trim()) throw badRequest('A reason is required.');
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw notFound('User not found.');

  await requestPasswordReset(user.email);
  await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  await recordAudit({
    actorUserId: actor.id,
    actorEmail: actor.email,
    action: AuditActions.passwordResetForced,
    entityType: 'user',
    entityId: userId,
    reason: reason.trim(),
  });
  return { ok: true, sessionsRevoked: true };
}

export async function createCreditPackage(
  actor: SessionUser,
  input: { name: string; credits: number; priceCents: number; currency?: string; sortOrder?: number },
) {
  const created = await prisma.creditPackage.create({
    data: {
      name: input.name.trim(),
      credits: input.credits,
      priceCents: input.priceCents,
      currency: input.currency ?? 'USD',
      sortOrder: input.sortOrder ?? 0,
      enabled: true,
    },
  });
  await recordAudit({
    actorUserId: actor.id,
    actorEmail: actor.email,
    action: AuditActions.packageCreated,
    entityType: 'credit_package',
    entityId: created.id,
    metadata: { name: created.name, credits: created.credits, priceCents: created.priceCents },
  });
  return created;
}

/**
 * Packages referenced by a payment are disabled rather than deleted, so historic
 * invoices keep resolving to the package they were sold as.
 */
export async function deleteCreditPackage(actor: SessionUser, packageId: string) {
  const pkg = await prisma.creditPackage.findUnique({ where: { id: packageId } });
  if (!pkg) throw notFound('Credit package not found.');

  const sold = await prisma.payment.count({ where: { packageId } });
  if (sold > 0) {
    const disabled = await prisma.creditPackage.update({
      where: { id: packageId },
      data: { enabled: false },
    });
    await recordAudit({
      actorUserId: actor.id,
      actorEmail: actor.email,
      action: AuditActions.packageDeleted,
      entityType: 'credit_package',
      entityId: packageId,
      reason: 'disabled instead of deleted: referenced by existing payments',
      metadata: { payments: sold },
    });
    return { deleted: false, disabled: true, package: disabled };
  }

  await prisma.creditPackage.delete({ where: { id: packageId } });
  await recordAudit({
    actorUserId: actor.id,
    actorEmail: actor.email,
    action: AuditActions.packageDeleted,
    entityType: 'credit_package',
    entityId: packageId,
  });
  return { deleted: true, disabled: false };
}

/** Stores provider credentials encrypted; they are never read back out. */
export async function setProviderCredentials(
  actor: SessionUser,
  providerId: string,
  settings: Record<string, unknown>,
) {
  const provider = await prisma.discoveryProviderConfig.findUnique({ where: { id: providerId } });
  if (!provider) throw notFound('Provider not found.');

  const encryptedConfig =
    Object.keys(settings).length === 0
      ? null
      : encryptSecret(JSON.stringify(settings), env.ENCRYPTION_KEY);

  await prisma.discoveryProviderConfig.update({
    where: { id: providerId },
    data: { encryptedConfig },
  });
  await recordAudit({
    actorUserId: actor.id,
    actorEmail: actor.email,
    action: AuditActions.providerCredentialsSet,
    entityType: 'provider',
    entityId: providerId,
    // Key names only - values never reach the audit log.
    metadata: { keys: Object.keys(settings) },
  });
  return { id: providerId, hasCredentials: encryptedConfig !== null };
}

export async function listProviders() {
  const providers = await prisma.discoveryProviderConfig.findMany({ orderBy: { priority: 'asc' } });
  // encryptedConfig is deliberately not included: provider secrets never leave
  // the server, not even for an administrator's browser.
  return providers.map((provider) => ({
    id: provider.id,
    key: provider.key,
    name: provider.name,
    type: provider.type,
    enabled: provider.enabled,
    priority: provider.priority,
    rateLimitPerMin: provider.rateLimitPerMin,
    dailyLimit: provider.dailyLimit,
    dailyUsed: provider.dailyUsed,
    healthStatus: provider.healthStatus,
    healthDetail: provider.healthDetail,
    lastHealthCheckAt: provider.lastHealthCheckAt?.toISOString() ?? null,
    hasCredentials: provider.encryptedConfig !== null,
  }));
}

export async function updateProvider(
  actor: SessionUser,
  providerId: string,
  input: { enabled?: boolean; priority?: number; rateLimitPerMin?: number; dailyLimit?: number | null },
) {
  const provider = await prisma.discoveryProviderConfig.update({
    where: { id: providerId },
    data: {
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
      ...(input.rateLimitPerMin !== undefined ? { rateLimitPerMin: input.rateLimitPerMin } : {}),
      ...(input.dailyLimit !== undefined ? { dailyLimit: input.dailyLimit } : {}),
    },
  });
  await recordAudit({
    actorUserId: actor.id,
    actorEmail: actor.email,
    action: AuditActions.providerToggled,
    entityType: 'provider',
    entityId: providerId,
    metadata: input as Record<string, unknown>,
  });
  return { id: provider.id, enabled: provider.enabled, priority: provider.priority };
}

export async function listFailedJobs(limit = 50) {
  return prisma.jobRecord.findMany({
    where: { status: 'FAILED' },
    orderBy: { updatedAt: 'desc' },
    take: Math.min(limit, 200),
  });
}

export async function listAuditLogs(options: { limit?: number; entityType?: string }) {
  return prisma.auditLog.findMany({
    where: options.entityType ? { entityType: options.entityType } : {},
    orderBy: { createdAt: 'desc' },
    take: Math.min(options.limit ?? 50, 200),
    include: { actor: { select: { email: true } } },
  });
}

export async function getApiUsage(limit = 100) {
  const [recent, byDay] = await Promise.all([
    prisma.apiUsageLog.findMany({ orderBy: { createdAt: 'desc' }, take: Math.min(limit, 500) }),
    prisma.$queryRaw<Array<{ day: Date; count: bigint; errors: bigint }>>`
      SELECT date_trunc('day', "createdAt")::date AS day,
             COUNT(*) AS count,
             COUNT(*) FILTER (WHERE "statusCode" >= 400) AS errors
        FROM api_usage_logs
       WHERE "createdAt" >= NOW() - INTERVAL '30 days'
       GROUP BY 1
       ORDER BY 1 ASC
    `,
  ]);
  return {
    recent: recent.map((row) => ({
      id: row.id,
      method: row.method,
      path: row.path,
      statusCode: row.statusCode,
      durationMs: row.durationMs,
      createdAt: row.createdAt.toISOString(),
    })),
    series: byDay.map((row) => ({
      date: new Date(row.day).toISOString().slice(0, 10),
      count: Number(row.count),
      errors: Number(row.errors),
    })),
  };
}
