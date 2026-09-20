import { env } from '@indexpilot/config';
import {
  applyMovementTx,
  AuditActions,
  getOrCreateWallet,
  type Prisma,
  prisma,
  recordAudit,
  type SubmissionSource,
} from '@indexpilot/db';
import {
  badRequest,
  clampLimit,
  decodeCursor,
  deriveOverallStatus,
  encodeCursor,
  forbidden,
  notFound,
  type OverallStatus,
  type Paginated,
  type SessionUser,
  type SubmissionResult,
  type UrlDetail,
  type UrlListItem,
} from '@indexpilot/shared';
import {
  parseSubmissionLines,
  parseSubmissionText,
  parseUploadedFile,
  type NormalizedUrl,
  type ParsedSubmission,
} from '@indexpilot/validation';
import { enqueueValidation } from '../lib/queue.js';
import { logger } from '../lib/logger.js';

export interface SubmitInput {
  user: SessionUser;
  projectId: string;
  text?: string;
  lines?: string[];
  file?: { filename: string; content: string; columnIndex?: number };
  source: SubmissionSource;
  idempotencyKey?: string | null;
}

/**
 * Bulk submission.
 *
 * Ordering inside the transaction is deliberate: the URL rows are inserted
 * first, then exactly as many credits as rows actually created are debited. If
 * the balance cannot cover them the whole transaction rolls back, so a customer
 * is never charged for work that was not created, and never gets work they did
 * not pay for.
 */
export async function submitUrls(input: SubmitInput): Promise<SubmissionResult> {
  const project = await prisma.project.findUnique({ where: { id: input.projectId } });
  if (!project) throw notFound('Project not found.');
  if (project.userId !== input.user.id && !isAdmin(input.user)) {
    throw forbidden('You do not have access to this project.');
  }
  if (project.status === 'ARCHIVED') {
    throw badRequest('This project is archived. Restore it before submitting more URLs.');
  }

  // Idempotent replay: return the original outcome rather than charging again.
  if (input.idempotencyKey) {
    const existing = await prisma.submissionBatch.findUnique({
      where: { userId_idempotencyKey: { userId: input.user.id, idempotencyKey: input.idempotencyKey } },
    });
    if (existing?.resultSnapshot) {
      return existing.resultSnapshot as unknown as SubmissionResult;
    }
  }

  const parsed = parseInput(input);
  if (parsed.accepted.length === 0 && parsed.invalidCount === 0) {
    throw badRequest('No URLs were found in the submission.');
  }

  // Drop URLs this project already tracks. Dedup is per project on purpose.
  const hashes = parsed.accepted.map((item) => item.normalizedUrlHash);
  const existingRows = hashes.length
    ? await prisma.urlRecord.findMany({
        where: { projectId: project.id, normalizedUrlHash: { in: hashes } },
        select: { normalizedUrlHash: true },
      })
    : [];
  const existingHashes = new Set(existingRows.map((row) => row.normalizedUrlHash));
  const fresh = parsed.accepted.filter((item) => !existingHashes.has(item.normalizedUrlHash));

  const result = await prisma.$transaction(
    async (tx) => {
      const batch = await tx.submissionBatch.create({
        data: {
          userId: input.user.id,
          projectId: project.id,
          source: input.source,
          idempotencyKey: input.idempotencyKey ?? null,
          receivedCount: parsed.receivedCount,
          duplicateCount: parsed.duplicatesInPayload + existingHashes.size,
          invalidCount: parsed.invalidCount,
          fileName: input.file?.filename ?? null,
        },
      });

      let created = 0;
      for (const chunk of chunked(fresh, 1_000)) {
        const inserted = await tx.urlRecord.createMany({
          data: chunk.map((item) => ({
            projectId: project.id,
            userId: project.userId,
            batchId: batch.id,
            originalUrl: item.originalUrl,
            normalizedUrl: item.normalizedUrl,
            normalizedUrlHash: item.normalizedUrlHash,
            scheme: item.scheme,
            hostname: item.hostname,
            path: item.path,
            creditsCharged: env.CREDITS_PER_URL,
          })),
          skipDuplicates: true,
        });
        created += inserted.count;
      }

      const creditsCharged = created * env.CREDITS_PER_URL;
      let balance = (await getOrCreateWallet(input.user.id, tx)).cachedBalance;

      if (creditsCharged > 0) {
        const movement = await applyMovementTx(tx, {
          userId: input.user.id,
          signedAmount: -creditsCharged,
          type: 'SUBMISSION_DEBIT',
          referenceType: 'submission_batch',
          referenceId: batch.id,
          description: `${created} URL(s) submitted to ${project.name}`,
        });
        balance = movement.balance;
      }

      const updatedBatch = await tx.submissionBatch.update({
        where: { id: batch.id },
        data: { acceptedCount: created, creditsCharged },
      });

      const snapshot: SubmissionResult = {
        batchId: updatedBatch.id,
        received: parsed.receivedCount,
        accepted: created,
        duplicatesInPayload: parsed.duplicatesInPayload,
        duplicatesInProject: existingHashes.size,
        invalid: parsed.invalidCount,
        creditsCharged,
        creditsRemaining: balance,
        invalidSamples: parsed.invalid.map((item) => ({
          url: item.originalUrl,
          reason: item.message,
        })),
      };

      await tx.submissionBatch.update({
        where: { id: batch.id },
        data: { resultSnapshot: snapshot as unknown as Prisma.InputJsonValue },
      });

      return snapshot;
    },
    { timeout: 120_000, maxWait: 15_000 },
  );

  // Enqueue only after the transaction committed, so a rollback cannot leave
  // jobs pointing at rows that do not exist.
  if (result.accepted > 0) {
    const createdUrls = await prisma.urlRecord.findMany({
      where: { batchId: result.batchId },
      select: { id: true },
    });
    await enqueueValidation(
      createdUrls.map((row) => ({
        urlId: row.id,
        projectId: project.id,
        userId: project.userId,
      })),
    ).catch((error: unknown) => {
      logger.error({ err: error, batchId: result.batchId }, 'failed to enqueue validation jobs');
    });
    await prisma.urlRecord.updateMany({
      where: { batchId: result.batchId },
      data: { processingStatus: 'QUEUED' },
    });
  }

  await recordAudit({
    actorUserId: input.user.id,
    actorEmail: input.user.email,
    action: AuditActions.urlsSubmitted,
    entityType: 'submission_batch',
    entityId: result.batchId,
    metadata: {
      projectId: project.id,
      accepted: result.accepted,
      invalid: result.invalid,
      credits: result.creditsCharged,
      source: input.source,
    },
  });

  return result;
}

function parseInput(input: SubmitInput): ParsedSubmission {
  const options = { maxUrls: env.MAX_URLS_PER_SUBMISSION, maxInvalidSamples: 25 };
  if (input.file) {
    return parseUploadedFile(input.file.filename, input.file.content, {
      ...options,
      columnIndex: input.file.columnIndex,
    });
  }
  if (input.lines) return parseSubmissionLines(input.lines, options);
  return parseSubmissionText(input.text ?? '', options);
}

/** Preview endpoint: parses without touching the database or credits. */
export async function previewSubmission(
  projectId: string,
  user: SessionUser,
  text: string,
): Promise<{
  accepted: number;
  invalid: number;
  duplicatesInPayload: number;
  duplicatesInProject: number;
  estimatedCredits: number;
  availableCredits: number;
  invalidSamples: Array<{ url: string; reason: string }>;
}> {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) throw notFound('Project not found.');
  if (project.userId !== user.id && !isAdmin(user)) throw forbidden();

  const parsed = parseSubmissionText(text, {
    maxUrls: env.MAX_URLS_PER_SUBMISSION,
    maxInvalidSamples: 25,
  });
  const hashes = parsed.accepted.map((item) => item.normalizedUrlHash);
  const existing = hashes.length
    ? await prisma.urlRecord.count({
        where: { projectId, normalizedUrlHash: { in: hashes } },
      })
    : 0;
  const wallet = await getOrCreateWallet(user.id);
  const billable = parsed.accepted.length - existing;

  return {
    accepted: billable,
    invalid: parsed.invalidCount,
    duplicatesInPayload: parsed.duplicatesInPayload,
    duplicatesInProject: existing,
    estimatedCredits: Math.max(0, billable) * env.CREDITS_PER_URL,
    availableCredits: wallet.cachedBalance,
    invalidSamples: parsed.invalid.map((item) => ({ url: item.originalUrl, reason: item.message })),
  };
}

export interface ListUrlsOptions {
  projectId?: string;
  status?: OverallStatus | 'all';
  search?: string;
  limit?: number;
  cursor?: string;
}

export async function listUrls(
  user: SessionUser,
  options: ListUrlsOptions,
): Promise<Paginated<UrlListItem>> {
  const take = clampLimit(options.limit);
  const where: Prisma.UrlRecordWhereInput = {
    userId: user.id,
    ...(options.projectId ? { projectId: options.projectId } : {}),
    ...(options.search
      ? { normalizedUrl: { contains: options.search.slice(0, 200), mode: 'insensitive' } }
      : {}),
    ...statusFilter(options.status),
  };

  if (options.cursor) {
    const cursor = decodeCursor(options.cursor);
    where.OR = [
      { createdAt: { lt: new Date(cursor.createdAt) } },
      { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } },
    ];
  }

  const rows = await prisma.urlRecord.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: take + 1,
    include: { project: { select: { name: true } } },
  });

  const hasMore = rows.length > take;
  const page = hasMore ? rows.slice(0, take) : rows;

  return {
    items: page.map((row) => toUrlListItem(row, row.project.name)),
    nextCursor:
      hasMore && page.length > 0
        ? encodeCursor({
            createdAt: (page[page.length - 1] as (typeof page)[number]).createdAt.toISOString(),
            id: (page[page.length - 1] as (typeof page)[number]).id,
          })
        : null,
  };
}

export async function getUrlDetail(user: SessionUser, urlId: string): Promise<UrlDetail> {
  const url = await prisma.urlRecord.findUnique({
    where: { id: urlId },
    include: {
      project: { select: { name: true } },
      validation: true,
      attempts: { orderBy: { attemptNumber: 'asc' } },
      indexChecks: { orderBy: { checkedAt: 'desc' } },
    },
  });
  if (!url) throw notFound('URL not found.');
  if (url.userId !== user.id && !isAdmin(user)) throw forbidden();

  return {
    ...toUrlListItem(url, url.project.name),
    creditsCharged: url.creditsCharged,
    refunded: url.refundedAt !== null,
    validation: url.validation
      ? {
          httpStatus: url.validation.httpStatus,
          finalUrl: url.validation.finalUrl,
          redirectCount: url.validation.redirectCount,
          robotsAllowed: url.validation.robotsAllowed,
          noindexDetected: url.validation.noindexDetected,
          canonicalUrl: url.validation.canonicalUrl,
          contentType: url.validation.contentType,
          contentLength: url.validation.contentLength,
          errorCode: url.validation.errorCode,
          errorMessage: url.validation.errorMessage,
          checkedAt: url.validation.checkedAt.toISOString(),
        }
      : null,
    attempts: url.attempts.map((attempt) => ({
      id: attempt.id,
      providerKey: attempt.providerKey,
      providerName: attempt.providerKey,
      attemptNumber: attempt.attemptNumber,
      status: attempt.status,
      startedAt: attempt.startedAt?.toISOString() ?? null,
      completedAt: attempt.completedAt?.toISOString() ?? null,
      providerReference: attempt.providerReference,
      errorCode: attempt.errorCode,
      errorMessage: attempt.errorMessage,
    })),
    indexChecks: url.indexChecks.map((check) => ({
      id: check.id,
      engine: check.engine,
      method: check.method,
      status: check.status,
      confidence: check.confidence,
      limitations: check.limitations,
      checkedAt: check.checkedAt.toISOString(),
    })),
  };
}

type UrlRow = Prisma.UrlRecordGetPayload<Record<string, never>>;

export function toUrlListItem(row: UrlRow, projectName?: string): UrlListItem {
  return {
    id: row.id,
    projectId: row.projectId,
    ...(projectName ? { projectName } : {}),
    originalUrl: row.originalUrl,
    normalizedUrl: row.normalizedUrl,
    hostname: row.hostname,
    validationStatus: row.validationStatus,
    processingStatus: row.processingStatus,
    verificationStatus: row.verificationStatus,
    overallStatus: deriveOverallStatus({
      validationStatus: row.validationStatus,
      processingStatus: row.processingStatus,
      verificationStatus: row.verificationStatus,
    }),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
  };
}

/** Maps a derived overall status back onto the stored dimensions for filtering. */
export function statusFilter(status?: OverallStatus | 'all'): Prisma.UrlRecordWhereInput {
  switch (status) {
    case undefined:
    case 'all':
      return {};
    case 'INDEXED_CONFIRMED':
      return { verificationStatus: 'INDEXED_CONFIRMED' };
    case 'NOT_CONFIRMED_INDEXED':
      return { verificationStatus: 'NOT_CONFIRMED_INDEXED' };
    case 'INDEX_CHECK_PENDING':
      return { verificationStatus: 'PENDING' };
    case 'BLOCKED':
      return { validationStatus: 'BLOCKED' };
    case 'INVALID':
      return { validationStatus: 'INVALID' };
    case 'VALIDATING':
      return { validationStatus: { in: ['RECEIVED', 'VALIDATING'] } };
    case 'FAILED':
      return { processingStatus: 'FAILED' };
    case 'CANCELLED':
      return { processingStatus: 'CANCELLED' };
    case 'CRAWL_DETECTED':
      return { processingStatus: 'CRAWL_DETECTED', verificationStatus: { not: 'INDEXED_CONFIRMED' } };
    case 'DISCOVERY_ATTEMPTED':
      return {
        processingStatus: 'DISCOVERY_ATTEMPTED',
        verificationStatus: { in: ['NOT_CHECKED', 'ERROR'] },
      };
    case 'PROCESSING':
      return { processingStatus: 'PROCESSING' };
    case 'QUEUED':
      return { processingStatus: { in: ['QUEUED', 'NOT_QUEUED'] }, validationStatus: 'VALID' };
    default:
      return {};
  }
}

function isAdmin(user: SessionUser): boolean {
  return user.role === 'ADMIN' || user.role === 'SUPER_ADMIN';
}

function* chunked<T>(items: T[], size: number): Generator<T[]> {
  for (let i = 0; i < items.length; i += size) {
    yield items.slice(i, i + size);
  }
}

export type { NormalizedUrl };
