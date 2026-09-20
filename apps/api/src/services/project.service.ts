import {
  AuditActions,
  type Prisma,
  prisma,
  recordAudit,
  type Project,
} from '@indexpilot/db';
import {
  clampLimit,
  conflict,
  decodeCursor,
  encodeCursor,
  notFound,
  type Paginated,
  type ProjectStats,
  type ProjectSummary,
  type SessionUser,
} from '@indexpilot/shared';

export async function createProject(
  user: SessionUser,
  input: { name: string; description?: string },
): Promise<ProjectSummary> {
  const existing = await prisma.project.findFirst({
    where: { userId: user.id, name: input.name.trim(), status: 'ACTIVE' },
  });
  if (existing) throw conflict('You already have an active project with that name.');

  const project = await prisma.project.create({
    data: {
      userId: user.id,
      name: input.name.trim(),
      description: input.description?.trim() || null,
    },
  });
  await recordAudit({
    actorUserId: user.id,
    actorEmail: user.email,
    action: AuditActions.projectCreated,
    entityType: 'project',
    entityId: project.id,
  });
  return toSummary(project, emptyStats());
}

export async function listProjects(
  user: SessionUser,
  options: { limit?: number; cursor?: string; includeArchived?: boolean },
): Promise<Paginated<ProjectSummary>> {
  const take = clampLimit(options.limit);
  const where: Prisma.ProjectWhereInput = {
    userId: user.id,
    ...(options.includeArchived ? {} : { status: 'ACTIVE' }),
  };
  if (options.cursor) {
    const cursor = decodeCursor(options.cursor);
    where.OR = [
      { createdAt: { lt: new Date(cursor.createdAt) } },
      { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } },
    ];
  }

  const rows = await prisma.project.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: take + 1,
  });
  const hasMore = rows.length > take;
  const page = hasMore ? rows.slice(0, take) : rows;
  const stats = await getStatsForProjects(page.map((row) => row.id));

  return {
    items: page.map((row) => toSummary(row, stats.get(row.id) ?? emptyStats())),
    nextCursor:
      hasMore && page.length > 0
        ? encodeCursor({
            createdAt: (page[page.length - 1] as Project).createdAt.toISOString(),
            id: (page[page.length - 1] as Project).id,
          })
        : null,
  };
}

export async function getProject(user: SessionUser, projectId: string): Promise<ProjectSummary> {
  const project = await requireOwnedProject(user, projectId);
  const stats = await getStatsForProjects([project.id]);
  return toSummary(project, stats.get(project.id) ?? emptyStats());
}

export async function updateProject(
  user: SessionUser,
  projectId: string,
  input: { name?: string; description?: string | null; status?: 'ACTIVE' | 'ARCHIVED' },
): Promise<ProjectSummary> {
  const project = await requireOwnedProject(user, projectId);
  const updated = await prisma.project.update({
    where: { id: project.id },
    data: {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}),
      ...(input.status !== undefined
        ? {
            status: input.status,
            archivedAt: input.status === 'ARCHIVED' ? new Date() : null,
          }
        : {}),
    },
  });
  if (input.status === 'ARCHIVED') {
    await recordAudit({
      actorUserId: user.id,
      actorEmail: user.email,
      action: AuditActions.projectArchived,
      entityType: 'project',
      entityId: project.id,
    });
  }
  const stats = await getStatsForProjects([updated.id]);
  return toSummary(updated, stats.get(updated.id) ?? emptyStats());
}

export async function requireOwnedProject(
  user: SessionUser,
  projectId: string,
): Promise<Project> {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) throw notFound('Project not found.');
  const isAdmin = user.role === 'ADMIN' || user.role === 'SUPER_ADMIN';
  if (project.userId !== user.id && !isAdmin) {
    // 404 rather than 403 so project ids cannot be probed for existence.
    throw notFound('Project not found.');
  }
  return project;
}

interface StatusCountRow {
  projectId: string;
  validationStatus: string;
  processingStatus: string;
  verificationStatus: string;
  count: bigint;
  credits: bigint | null;
}

/**
 * One grouped query for any number of projects. The dashboard and project lists
 * never load URL rows into memory to count them.
 */
export async function getStatsForProjects(
  projectIds: string[],
): Promise<Map<string, ProjectStats>> {
  const result = new Map<string, ProjectStats>();
  if (projectIds.length === 0) return result;

  const rows = await prisma.$queryRaw<StatusCountRow[]>`
    SELECT "projectId",
           "validationStatus"::text   AS "validationStatus",
           "processingStatus"::text   AS "processingStatus",
           "verificationStatus"::text AS "verificationStatus",
           COUNT(*)                   AS count,
           SUM("creditsCharged")      AS credits
      FROM url_records
     WHERE "projectId" = ANY(${projectIds}::text[])
     GROUP BY 1, 2, 3, 4
  `;

  for (const id of projectIds) result.set(id, emptyStats());

  for (const row of rows) {
    const stats = result.get(row.projectId);
    if (!stats) continue;
    const count = Number(row.count);
    stats.totalUrls += count;
    stats.creditsSpent += Number(row.credits ?? 0);

    if (row.validationStatus === 'VALID') stats.valid += count;
    if (row.validationStatus === 'INVALID') stats.invalid += count;
    if (row.validationStatus === 'BLOCKED') stats.blocked += count;

    if (row.verificationStatus === 'INDEXED_CONFIRMED') stats.indexedConfirmed += count;
    else if (row.verificationStatus === 'NOT_CONFIRMED_INDEXED') stats.notConfirmedIndexed += count;
    else if (row.processingStatus === 'FAILED') stats.failed += count;
    else if (row.processingStatus === 'CRAWL_DETECTED') stats.crawlDetected += count;
    else if (row.processingStatus === 'DISCOVERY_ATTEMPTED') stats.discoveryAttempted += count;
    else if (row.processingStatus === 'PROCESSING') stats.processing += count;
    else if (row.processingStatus === 'QUEUED' || row.processingStatus === 'NOT_QUEUED') {
      if (row.validationStatus === 'VALID' || row.validationStatus === 'RECEIVED' || row.validationStatus === 'VALIDATING') {
        stats.queued += count;
      }
    }
  }

  for (const stats of result.values()) {
    stats.pending =
      stats.queued + stats.processing + stats.discoveryAttempted + stats.crawlDetected;
  }
  return result;
}

export function emptyStats(): ProjectStats {
  return {
    totalUrls: 0,
    creditsSpent: 0,
    valid: 0,
    invalid: 0,
    blocked: 0,
    queued: 0,
    processing: 0,
    discoveryAttempted: 0,
    crawlDetected: 0,
    indexedConfirmed: 0,
    notConfirmedIndexed: 0,
    failed: 0,
    pending: 0,
  };
}

export function toSummary(project: Project, stats: ProjectStats): ProjectSummary {
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    status: project.status,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
    archivedAt: project.archivedAt?.toISOString() ?? null,
    stats,
  };
}
