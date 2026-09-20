import {
  AuditActions,
  prisma,
  recordAudit,
  type Prisma,
} from '@indexpilot/db';
import {
  TOOL_CATALOG,
  badRequest,
  conflict,
  hashPassword,
  notFound,
  type SessionUser,
  type ToolEngineKey,
} from '@indexpilot/shared';

/**
 * Admin powers that the operations team needs day to day: managing the public
 * tool catalogue, granting individual accounts access to gated tools, setting a
 * password directly, and cutting sessions off.
 *
 * Every function here takes the acting admin and writes an audit row. That is
 * not optional decoration — these are the actions that would otherwise be
 * impossible to explain after the fact.
 */

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// --- Tool catalogue -------------------------------------------------------

export interface ToolInput {
  slug: string;
  name: string;
  engine: ToolEngineKey;
  headline: string;
  intro: string;
  metaTitle: string;
  metaDescription: string;
  enabled?: boolean;
  requiresAuth?: boolean;
  listed?: boolean;
  sortOrder?: number;
}

export async function listToolsForAdmin() {
  const [tools, runCounts] = await Promise.all([
    prisma.toolDefinition.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { grants: true } } },
    }),
    prisma.toolRun.groupBy({
      by: ['toolSlug'],
      _count: { _all: true },
    }),
  ]);

  const runsBySlug = new Map(runCounts.map((row) => [row.toolSlug, row._count._all]));

  return {
    items: tools.map((tool) => ({
      id: tool.id,
      slug: tool.slug,
      name: tool.name,
      engine: tool.engine,
      headline: tool.headline,
      intro: tool.intro,
      metaTitle: tool.metaTitle,
      metaDescription: tool.metaDescription,
      enabled: tool.enabled,
      requiresAuth: tool.requiresAuth,
      listed: tool.listed,
      sortOrder: tool.sortOrder,
      grants: tool._count.grants,
      runs: runsBySlug.get(tool.slug) ?? 0,
      createdAt: tool.createdAt.toISOString(),
      updatedAt: tool.updatedAt.toISOString(),
    })),
    /** Slugs shipped in code that have not been imported into the database yet. */
    unseeded: TOOL_CATALOG.filter(
      (entry) => !tools.some((tool) => tool.slug === entry.slug),
    ).map((entry) => entry.slug),
  };
}

export async function createTool(actor: SessionUser, input: ToolInput) {
  const slug = input.slug.trim().toLowerCase();
  if (!SLUG_RE.test(slug)) {
    throw badRequest('The slug may only contain lowercase letters, numbers and single hyphens.');
  }

  const existing = await prisma.toolDefinition.findUnique({ where: { slug } });
  if (existing) throw conflict(`A tool already lives at /tools/${slug}.`);

  const tool = await prisma.toolDefinition.create({
    data: {
      slug,
      name: input.name.trim(),
      engine: input.engine,
      headline: input.headline.trim(),
      intro: input.intro.trim(),
      metaTitle: input.metaTitle.trim(),
      metaDescription: input.metaDescription.trim(),
      enabled: input.enabled ?? true,
      requiresAuth: input.requiresAuth ?? false,
      listed: input.listed ?? true,
      sortOrder: input.sortOrder ?? 100,
    },
  });

  await recordAudit({
    actorUserId: actor.id,
    actorEmail: actor.email,
    action: AuditActions.toolCreated,
    entityType: 'tool',
    entityId: tool.id,
    metadata: { slug, engine: input.engine },
  });
  return tool;
}

export async function updateTool(
  actor: SessionUser,
  id: string,
  input: Partial<Omit<ToolInput, 'slug'>> & { slug?: string },
) {
  const tool = await prisma.toolDefinition.findUnique({ where: { id } });
  if (!tool) throw notFound('Tool not found.');

  const data: Prisma.ToolDefinitionUpdateInput = {};
  if (input.slug !== undefined) {
    const slug = input.slug.trim().toLowerCase();
    if (!SLUG_RE.test(slug)) {
      throw badRequest('The slug may only contain lowercase letters, numbers and single hyphens.');
    }
    if (slug !== tool.slug) {
      const clash = await prisma.toolDefinition.findUnique({ where: { slug } });
      if (clash) throw conflict(`A tool already lives at /tools/${slug}.`);
      data.slug = slug;
    }
  }
  if (input.name !== undefined) data.name = input.name.trim();
  if (input.engine !== undefined) data.engine = input.engine;
  if (input.headline !== undefined) data.headline = input.headline.trim();
  if (input.intro !== undefined) data.intro = input.intro.trim();
  if (input.metaTitle !== undefined) data.metaTitle = input.metaTitle.trim();
  if (input.metaDescription !== undefined) data.metaDescription = input.metaDescription.trim();
  if (input.enabled !== undefined) data.enabled = input.enabled;
  if (input.requiresAuth !== undefined) data.requiresAuth = input.requiresAuth;
  if (input.listed !== undefined) data.listed = input.listed;
  if (input.sortOrder !== undefined) data.sortOrder = input.sortOrder;

  const updated = await prisma.toolDefinition.update({ where: { id }, data });
  await recordAudit({
    actorUserId: actor.id,
    actorEmail: actor.email,
    action: AuditActions.toolUpdated,
    entityType: 'tool',
    entityId: id,
    metadata: data as Record<string, unknown>,
  });
  return updated;
}

export async function deleteTool(actor: SessionUser, id: string) {
  const tool = await prisma.toolDefinition.findUnique({ where: { id } });
  if (!tool) throw notFound('Tool not found.');

  // Runs keep the slug so history survives; the foreign key is nulled out.
  await prisma.toolDefinition.delete({ where: { id } });
  await recordAudit({
    actorUserId: actor.id,
    actorEmail: actor.email,
    action: AuditActions.toolDeleted,
    entityType: 'tool',
    entityId: id,
    metadata: { slug: tool.slug },
  });
  return { ok: true };
}

/** Imports any code-level catalogue entries that are not in the database yet. */
export async function seedMissingTools(actor: SessionUser) {
  const existing = await prisma.toolDefinition.findMany({ select: { slug: true } });
  const have = new Set(existing.map((row) => row.slug));
  const missing = TOOL_CATALOG.filter((entry) => !have.has(entry.slug));

  if (missing.length === 0) return { created: 0 };

  await prisma.toolDefinition.createMany({
    data: missing.map((entry) => ({
      slug: entry.slug,
      name: entry.name,
      engine: entry.engine,
      headline: entry.headline,
      intro: entry.intro,
      metaTitle: entry.metaTitle,
      metaDescription: entry.metaDescription,
      listed: entry.listed,
      sortOrder: entry.sortOrder,
    })),
    skipDuplicates: true,
  });

  await recordAudit({
    actorUserId: actor.id,
    actorEmail: actor.email,
    action: AuditActions.toolCreated,
    entityType: 'tool',
    metadata: { seeded: missing.map((entry) => entry.slug) },
  });
  return { created: missing.length };
}

// --- Per-user tool access -------------------------------------------------

export async function grantToolAccess(
  actor: SessionUser,
  input: { userId: string; toolId: string; hourlyLimit?: number | null; expiresAt?: string | null; note?: string },
) {
  const [user, tool] = await Promise.all([
    prisma.user.findUnique({ where: { id: input.userId } }),
    prisma.toolDefinition.findUnique({ where: { id: input.toolId } }),
  ]);
  if (!user) throw notFound('User not found.');
  if (!tool) throw notFound('Tool not found.');

  let expiresAt: Date | null = null;
  if (input.expiresAt) {
    const parsed = new Date(input.expiresAt);
    if (Number.isNaN(parsed.getTime())) throw badRequest('That expiry date could not be read.');
    if (parsed.getTime() <= Date.now()) throw badRequest('The expiry date must be in the future.');
    expiresAt = parsed;
  }

  const grant = await prisma.toolAccessGrant.upsert({
    where: { userId_toolId: { userId: input.userId, toolId: input.toolId } },
    create: {
      userId: input.userId,
      toolId: input.toolId,
      grantedById: actor.id,
      hourlyLimit: input.hourlyLimit ?? null,
      expiresAt,
      note: input.note?.trim() || null,
    },
    update: {
      grantedById: actor.id,
      hourlyLimit: input.hourlyLimit ?? null,
      expiresAt,
      note: input.note?.trim() || null,
    },
  });

  await recordAudit({
    actorUserId: actor.id,
    actorEmail: actor.email,
    action: AuditActions.toolAccessGranted,
    entityType: 'user',
    entityId: input.userId,
    metadata: { tool: tool.slug, expiresAt: expiresAt?.toISOString() ?? null },
  });
  return grant;
}

export async function revokeToolAccess(actor: SessionUser, userId: string, toolId: string) {
  const grant = await prisma.toolAccessGrant.findUnique({
    where: { userId_toolId: { userId, toolId } },
    include: { tool: { select: { slug: true } } },
  });
  if (!grant) throw notFound('That grant does not exist.');

  await prisma.toolAccessGrant.delete({ where: { id: grant.id } });
  await recordAudit({
    actorUserId: actor.id,
    actorEmail: actor.email,
    action: AuditActions.toolAccessRevoked,
    entityType: 'user',
    entityId: userId,
    metadata: { tool: grant.tool.slug },
  });
  return { ok: true };
}

// --- Account controls -----------------------------------------------------

/**
 * Sets a user's password directly.
 *
 * This exists because support sometimes has to hand an account back to someone
 * who cannot receive the reset email. It is deliberately noisy: every session
 * is cut, and the audit row names the admin who did it. The new password is
 * returned once, to the admin who set it, and never stored in plaintext.
 */
export async function setUserPassword(
  actor: SessionUser,
  userId: string,
  newPassword: string,
  reason: string,
) {
  if (!reason.trim()) throw badRequest('A reason is required.');

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw notFound('User not found.');

  // An admin must not be able to seize an account with more privilege than
  // their own by resetting its password.
  if (
    (user.role === 'ADMIN' || user.role === 'SUPER_ADMIN') &&
    actor.role !== 'SUPER_ADMIN'
  ) {
    throw badRequest('Only a super admin can set the password of another administrator.');
  }

  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(newPassword) },
  });
  const revoked = await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  await recordAudit({
    actorUserId: actor.id,
    actorEmail: actor.email,
    action: AuditActions.passwordSetByAdmin,
    entityType: 'user',
    entityId: userId,
    reason: reason.trim(),
    metadata: { sessionsRevoked: revoked.count },
  });

  return { ok: true, sessionsRevoked: revoked.count };
}

export async function revokeUserSessions(actor: SessionUser, userId: string, reason: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw notFound('User not found.');

  const revoked = await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  await recordAudit({
    actorUserId: actor.id,
    actorEmail: actor.email,
    action: AuditActions.sessionsRevoked,
    entityType: 'user',
    entityId: userId,
    reason: reason.trim() || null,
    metadata: { count: revoked.count },
  });
  return { ok: true, sessionsRevoked: revoked.count };
}

// --- Tool analytics -------------------------------------------------------

/**
 * Which tools people actually finish using.
 *
 * The build brief asks for completions rather than pageviews, because that is
 * the number that tells you which tool to invest in next.
 */
export async function getToolAnalytics(days = 30) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const [byTool, byOutcome, totals, topHosts] = await Promise.all([
    prisma.toolRun.groupBy({
      by: ['toolSlug'],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
      _avg: { durationMs: true },
      orderBy: { _count: { toolSlug: 'desc' } },
    }),
    prisma.toolRun.groupBy({
      by: ['outcome'],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
    }),
    prisma.toolRun.aggregate({
      where: { createdAt: { gte: since } },
      _count: { _all: true },
      _avg: { durationMs: true },
    }),
    prisma.toolRun.groupBy({
      by: ['targetHost'],
      where: { createdAt: { gte: since }, targetHost: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { targetHost: 'desc' } },
      take: 10,
    }),
  ]);

  const [signedIn, anonymous] = await Promise.all([
    prisma.toolRun.count({ where: { createdAt: { gte: since }, userId: { not: null } } }),
    prisma.toolRun.count({ where: { createdAt: { gte: since }, userId: null } }),
  ]);

  return {
    days,
    totals: {
      runs: totals._count._all,
      avgDurationMs: Math.round(totals._avg.durationMs ?? 0),
      signedIn,
      anonymous,
    },
    byTool: byTool.map((row) => ({
      slug: row.toolSlug,
      runs: row._count._all,
      avgDurationMs: Math.round(row._avg.durationMs ?? 0),
    })),
    byOutcome: Object.fromEntries(byOutcome.map((row) => [row.outcome, row._count._all])),
    topHosts: topHosts.map((row) => ({ host: row.targetHost, runs: row._count._all })),
  };
}
