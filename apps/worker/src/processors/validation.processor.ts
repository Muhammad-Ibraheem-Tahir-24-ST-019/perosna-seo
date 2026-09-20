import type { Job } from 'bullmq';
import { env } from '@indexpilot/config';
import { type Prisma, prisma } from '@indexpilot/db';
import { validateUrl } from '@indexpilot/validation';
import { jobIds } from '@indexpilot/shared';
import { fetchOptions, logger, getQueue, QUEUE_NAMES, DEFAULT_JOB_OPTIONS } from '../lib/runtime.js';
import { refundUrl } from '../lib/refunds.js';

export interface ValidationJobData {
  urlId: string;
  projectId: string;
  userId: string;
}

/**
 * Stage 1: pre-flight checks.
 *
 * Runs the SSRF-safe fetch, robots.txt evaluation and HTML signal extraction,
 * stores structured diagnostics, and either promotes the URL to the processing
 * queue or ends its life early and refunds the credit.
 */
export async function processValidationJob(job: Job<ValidationJobData>): Promise<void> {
  const { urlId } = job.data;

  const url = await prisma.urlRecord.findUnique({ where: { id: urlId } });
  if (!url) {
    logger.warn({ urlId }, 'validation job for a missing URL; dropping');
    return;
  }

  // Idempotency guard: a retry after a successful run must not redo the work.
  if (url.validationStatus !== 'RECEIVED' && url.validationStatus !== 'VALIDATING') {
    logger.debug({ urlId, status: url.validationStatus }, 'validation already settled; skipping');
    return;
  }

  await prisma.urlRecord.update({
    where: { id: urlId },
    data: { validationStatus: 'VALIDATING' },
  });

  const outcome = await validateUrl(url.normalizedUrl, {
    ...fetchOptions,
    checkRobotsTxt: true,
  });

  await prisma.urlValidationResult.upsert({
    where: { urlId },
    create: {
      urlId,
      httpStatus: outcome.httpStatus,
      finalUrl: outcome.finalUrl,
      redirectCount: outcome.redirectCount,
      redirectChain: outcome.redirectChain as unknown as Prisma.InputJsonValue,
      robotsAllowed: outcome.robotsAllowed,
      robotsNote: outcome.robotsNote,
      noindexDetected: outcome.noindexDetected,
      noindexSource: outcome.noindexSource,
      canonicalUrl: outcome.canonicalUrl,
      canonicalMismatch: outcome.canonicalMismatch,
      title: outcome.title,
      contentType: outcome.contentType,
      contentLength: outcome.contentLength,
      contentAccessible: outcome.contentAccessible,
      peerAddress: outcome.peerAddress,
      durationMs: outcome.durationMs,
      warnings: outcome.warnings as unknown as Prisma.InputJsonValue,
      errorCode: outcome.errorCode,
      errorMessage: outcome.errorMessage,
    },
    update: {
      httpStatus: outcome.httpStatus,
      finalUrl: outcome.finalUrl,
      redirectCount: outcome.redirectCount,
      redirectChain: outcome.redirectChain as unknown as Prisma.InputJsonValue,
      robotsAllowed: outcome.robotsAllowed,
      robotsNote: outcome.robotsNote,
      noindexDetected: outcome.noindexDetected,
      noindexSource: outcome.noindexSource,
      canonicalUrl: outcome.canonicalUrl,
      canonicalMismatch: outcome.canonicalMismatch,
      title: outcome.title,
      contentType: outcome.contentType,
      contentLength: outcome.contentLength,
      contentAccessible: outcome.contentAccessible,
      peerAddress: outcome.peerAddress,
      durationMs: outcome.durationMs,
      warnings: outcome.warnings as unknown as Prisma.InputJsonValue,
      errorCode: outcome.errorCode,
      errorMessage: outcome.errorMessage,
      checkedAt: new Date(),
    },
  });

  if (outcome.verdict === 'VALID') {
    await prisma.urlRecord.update({
      where: { id: urlId },
      data: {
        validationStatus: 'VALID',
        processingStatus: 'QUEUED',
        lastCheckedAt: new Date(),
      },
    });
    await getQueue(QUEUE_NAMES.urlProcessing).add(
      'process-url',
      { urlId, projectId: url.projectId, userId: url.userId, attemptNumber: 1 },
      { ...DEFAULT_JOB_OPTIONS, jobId: jobIds.processUrl(urlId, 1) },
    );
    return;
  }

  await prisma.urlRecord.update({
    where: { id: urlId },
    data: {
      validationStatus: outcome.verdict,
      processingStatus: 'NOT_QUEUED',
      lastCheckedAt: new Date(),
    },
  });

  // The URL will never be processed, so the credit goes back.
  await refundUrl(
    urlId,
    outcome.verdict === 'BLOCKED'
      ? (outcome.errorMessage ?? 'blocked before processing')
      : (outcome.errorMessage ?? 'failed validation'),
  );

  logger.info(
    { urlId, verdict: outcome.verdict, code: outcome.errorCode },
    'URL did not pass validation',
  );
}

export const validationConcurrency = env.WORKER_CONCURRENCY_VALIDATION;
