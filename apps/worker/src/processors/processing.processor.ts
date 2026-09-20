import type { Job } from 'bullmq';
import { env } from '@indexpilot/config';
import { type Prisma, prisma } from '@indexpilot/db';
import type { ProviderSubmissionResult } from '@indexpilot/providers';
import { jobIds } from '@indexpilot/shared';
import {
  DEFAULT_JOB_OPTIONS,
  getQueue,
  getRegistry,
  logger,
  QUEUE_NAMES,
} from '../lib/runtime.js';
import { refundUrl } from '../lib/refunds.js';

export interface ProcessingJobData {
  urlId: string;
  projectId: string;
  userId: string;
  attemptNumber: number;
}

export class RetryableProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetryableProviderError';
  }
}

/**
 * Stage 2: discovery submission.
 *
 * Every attempt is recorded, including failures, so the URL detail page can show
 * a truthful history. The outcome vocabulary stops at CRAWL_DETECTED - nothing
 * in this processor may write an "indexed" status.
 */
export async function processUrlJob(job: Job<ProcessingJobData>): Promise<void> {
  const { urlId, attemptNumber } = job.data;

  const url = await prisma.urlRecord.findUnique({ where: { id: urlId } });
  if (!url) {
    logger.warn({ urlId }, 'processing job for a missing URL; dropping');
    return;
  }
  if (url.validationStatus !== 'VALID') {
    logger.debug({ urlId }, 'URL is not valid; skipping processing');
    return;
  }
  if (url.processingStatus === 'CANCELLED') return;

  // If this attempt already succeeded, a retry is a no-op.
  const existingAttempt = await prisma.processingAttempt.findUnique({
    where: { urlId_attemptNumber: { urlId, attemptNumber } },
  });
  if (existingAttempt?.status === 'SUCCEEDED') {
    logger.debug({ urlId, attemptNumber }, 'attempt already succeeded; skipping');
    return;
  }

  const registry = await getRegistry();
  const candidates = registry.available();
  if (candidates.length === 0) {
    throw new RetryableProviderError('No discovery provider is currently available.');
  }

  await prisma.urlRecord.update({
    where: { id: urlId },
    data: { processingStatus: 'PROCESSING' },
  });

  const attempt = await prisma.processingAttempt.upsert({
    where: { urlId_attemptNumber: { urlId, attemptNumber } },
    create: {
      urlId,
      attemptNumber,
      providerKey: candidates[0]?.config.key ?? 'unknown',
      status: 'RUNNING',
      startedAt: new Date(),
    },
    update: { status: 'RUNNING', startedAt: new Date(), errorCode: null, errorMessage: null },
  });

  let lastResult: ProviderSubmissionResult | null = null;
  let usedKey = attempt.providerKey;

  // Walk the priority-ordered list: one provider failing must not stop the URL.
  for (const candidate of candidates) {
    usedKey = candidate.config.key;
    registry.consume(candidate.config.key);
    try {
      lastResult = await candidate.provider.submit({
        urlId,
        url: url.normalizedUrl,
        hostname: url.hostname,
        projectId: url.projectId,
        userId: url.userId,
        attemptNumber,
      });
    } catch (error) {
      logger.warn({ err: error, provider: candidate.config.key, urlId }, 'provider threw');
      lastResult = {
        outcome: 'ERROR',
        errorCode: 'PROVIDER_EXCEPTION',
        errorMessage: (error as Error).message,
        retryable: true,
      };
    }

    if (lastResult.outcome === 'SUBMITTED' || lastResult.outcome === 'CRAWL_DETECTED') {
      registry.markHealthy(candidate.config.key);
      break;
    }
    if (lastResult.outcome === 'RATE_LIMITED' || lastResult.outcome === 'ERROR') {
      registry.markUnhealthy(candidate.config.key, lastResult.retryAfterMs ?? 60_000);
      continue;
    }
    // REJECTED is a definitive verdict for this URL; other providers will agree.
    break;
  }

  const result = lastResult ?? {
    outcome: 'ERROR' as const,
    errorCode: 'NO_RESULT',
    errorMessage: 'No provider produced a result.',
    retryable: true,
  };

  const succeeded = result.outcome === 'SUBMITTED' || result.outcome === 'CRAWL_DETECTED';

  await prisma.processingAttempt.update({
    where: { id: attempt.id },
    data: {
      providerKey: usedKey,
      status: succeeded ? 'SUCCEEDED' : 'FAILED',
      completedAt: new Date(),
      providerReference: result.reference ?? null,
      errorCode: result.errorCode ?? null,
      errorMessage: result.errorMessage ?? null,
      metadata: (result.metadata ?? { providerStatus: result.providerStatus }) as Prisma.InputJsonValue,
    },
  });

  if (succeeded) {
    const firstDelayMs = env.VERIFICATION_FIRST_DELAY_HOURS * 60 * 60 * 1000;
    const nextVerificationAt = new Date(Date.now() + firstDelayMs);

    await prisma.urlRecord.update({
      where: { id: urlId },
      data: {
        processingStatus: result.outcome === 'CRAWL_DETECTED' ? 'CRAWL_DETECTED' : 'DISCOVERY_ATTEMPTED',
        verificationStatus: 'PENDING',
        verificationRound: 0,
        nextVerificationAt,
        lastCheckedAt: new Date(),
      },
    });

    await getQueue(QUEUE_NAMES.indexVerification).add(
      'verify-url',
      { urlId, round: 1 },
      { ...DEFAULT_JOB_OPTIONS, jobId: jobIds.verifyUrl(urlId, 1), delay: firstDelayMs },
    );
    return;
  }

  const retryable = result.retryable !== false && result.outcome !== 'REJECTED';
  const attemptsLeft = job.attemptsMade + 1 < (job.opts.attempts ?? 1);

  if (retryable && attemptsLeft) {
    // Throwing hands control back to BullMQ, which applies exponential backoff.
    throw new RetryableProviderError(result.errorMessage ?? 'Provider submission failed.');
  }

  await prisma.urlRecord.update({
    where: { id: urlId },
    data: { processingStatus: 'FAILED', lastCheckedAt: new Date() },
  });
  await refundUrl(urlId, result.errorMessage ?? 'discovery submission failed');

  logger.info(
    { urlId, provider: usedKey, outcome: result.outcome, code: result.errorCode },
    'processing finished without a discovery signal',
  );
}

export const processingConcurrency = env.WORKER_CONCURRENCY_PROCESSING;
