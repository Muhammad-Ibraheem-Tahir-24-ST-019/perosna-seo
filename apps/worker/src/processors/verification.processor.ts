import type { Job } from 'bullmq';
import { env } from '@indexpilot/config';
import { type Prisma, prisma } from '@indexpilot/db';
import { createIndexChecker } from '@indexpilot/providers';
import { jobIds } from '@indexpilot/shared';
import { DEFAULT_JOB_OPTIONS, getQueue, logger, QUEUE_NAMES } from '../lib/runtime.js';

export interface VerificationJobData {
  urlId: string;
  round: number;
}

/**
 * Stage 3: index verification.
 *
 * This is the ONLY place that may write an indexed status, and it always stores
 * the method, the confidence and the limitation text alongside the verdict. A
 * negative lookup is recorded as NOT_CONFIRMED_INDEXED - never as "not indexed".
 */
export async function processVerificationJob(job: Job<VerificationJobData>): Promise<void> {
  const { urlId, round } = job.data;

  const url = await prisma.urlRecord.findUnique({ where: { id: urlId } });
  if (!url) return;
  if (url.validationStatus !== 'VALID') return;
  if (url.verificationStatus === 'INDEXED_CONFIRMED') return;

  // One row per (url, engine, round) makes a retry idempotent.
  const checker = createIndexChecker();
  const existing = await prisma.indexCheck.findUnique({
    where: { urlId_engine_round: { urlId, engine: checker.engine, round } },
  });
  if (existing) {
    logger.debug({ urlId, round }, 'verification round already recorded; skipping');
    return;
  }

  const result = await checker.check(url.normalizedUrl);

  await prisma.indexCheck.create({
    data: {
      urlId,
      engine: result.engine,
      method: result.method,
      status: result.verdict,
      confidence: result.confidence,
      limitations: result.limitations ?? null,
      round,
      metadata: (result.metadata ?? {}) as Prisma.InputJsonValue,
      error: result.error ?? null,
    },
  });

  const maxRounds = env.VERIFICATION_MAX_CHECKS;
  const shouldRecheck = result.verdict !== 'INDEXED_CONFIRMED' && round < maxRounds;
  const recheckDelayMs = env.VERIFICATION_RECHECK_HOURS * 60 * 60 * 1000;

  await prisma.urlRecord.update({
    where: { id: urlId },
    data: {
      verificationStatus:
        result.verdict === 'INDEXED_CONFIRMED'
          ? 'INDEXED_CONFIRMED'
          : shouldRecheck
            ? 'PENDING'
            : result.verdict === 'ERROR'
              ? 'ERROR'
              : 'NOT_CONFIRMED_INDEXED',
      verificationRound: round,
      nextVerificationAt: shouldRecheck ? new Date(Date.now() + recheckDelayMs) : null,
      lastCheckedAt: new Date(),
    },
  });

  if (shouldRecheck) {
    await getQueue(QUEUE_NAMES.indexVerification).add(
      'verify-url',
      { urlId, round: round + 1 },
      { ...DEFAULT_JOB_OPTIONS, jobId: jobIds.verifyUrl(urlId, round + 1), delay: recheckDelayMs },
    );
  }

  logger.info(
    { urlId, round, verdict: result.verdict, method: result.method },
    'index verification recorded',
  );
}

export const verificationConcurrency = env.WORKER_CONCURRENCY_VERIFICATION;
