import { Worker, type Job } from 'bullmq';
import { env } from '@indexpilot/config';
import { disconnectPrisma } from '@indexpilot/db';
import { jobIds, QUEUE_NAMES, type QueueName } from '@indexpilot/shared';
import {
  closeRuntime,
  DEFAULT_JOB_OPTIONS,
  getConnection,
  getQueue,
  logger,
  trackJob,
} from './lib/runtime.js';
import { processValidationJob, validationConcurrency } from './processors/validation.processor.js';
import { processUrlJob, processingConcurrency } from './processors/processing.processor.js';
import {
  processVerificationJob,
  verificationConcurrency,
} from './processors/verification.processor.js';
import { processReportJob, reportConcurrency } from './processors/report.processor.js';
import { processMaintenanceJob } from './processors/maintenance.processor.js';

const workers: Worker[] = [];

/**
 * Wraps a processor with job bookkeeping and a per-job timeout so one hung
 * request cannot occupy a concurrency slot forever.
 */
function createWorker<T>(
  name: QueueName,
  handler: (job: Job<T>) => Promise<void>,
  concurrency: number,
  entityType: string,
  entityIdOf: (job: Job<T>) => string,
): Worker {
  const worker = new Worker<T>(
    name,
    async (job) => {
      await trackJob(name, String(job.id), entityType, entityIdOf(job), 'ACTIVE', {
        attempts: job.attemptsMade,
      });
      await handler(job);
      await trackJob(name, String(job.id), entityType, entityIdOf(job), 'COMPLETED', {
        attempts: job.attemptsMade + 1,
      });
    },
    {
      connection: getConnection(),
      concurrency,
      // Keeps a crashed worker's jobs from being stuck as "active" forever.
      stalledInterval: 30_000,
      maxStalledCount: 2,
    },
  );

  worker.on('failed', (job, error) => {
    logger.error(
      { queue: name, jobId: job?.id, attempts: job?.attemptsMade, err: error },
      'job failed',
    );
    if (job) {
      void trackJob(name, String(job.id), entityType, entityIdOf(job), 'FAILED', {
        attempts: job.attemptsMade,
        error: error.message.slice(0, 500),
      });
    }
  });

  worker.on('error', (error) => {
    logger.error({ queue: name, err: error }, 'worker error');
  });

  workers.push(worker);
  return worker;
}

async function scheduleRepeatableJobs(): Promise<void> {
  const maintenance = getQueue(QUEUE_NAMES.maintenance);
  await maintenance.add(
    'sweep',
    { task: 'sweep' },
    { ...DEFAULT_JOB_OPTIONS, repeat: { every: 5 * 60 * 1000 }, jobId: jobIds.maintenance('sweep') },
  );
  await maintenance.add(
    'provider-health',
    { task: 'provider-health' },
    {
      ...DEFAULT_JOB_OPTIONS,
      repeat: { every: 10 * 60 * 1000 },
      jobId: jobIds.maintenance('provider-health'),
    },
  );
}

async function main(): Promise<void> {
  createWorker(
    QUEUE_NAMES.urlValidation,
    processValidationJob,
    validationConcurrency,
    'url',
    (job) => job.data.urlId,
  );
  createWorker(
    QUEUE_NAMES.urlProcessing,
    processUrlJob,
    processingConcurrency,
    'url',
    (job) => job.data.urlId,
  );
  createWorker(
    QUEUE_NAMES.indexVerification,
    processVerificationJob,
    verificationConcurrency,
    'url',
    (job) => job.data.urlId,
  );
  createWorker(
    QUEUE_NAMES.reportGeneration,
    processReportJob,
    reportConcurrency,
    'report',
    (job) => job.data.reportId,
  );
  createWorker(
    QUEUE_NAMES.maintenance,
    processMaintenanceJob,
    1,
    'system',
    () => 'maintenance',
  );

  await scheduleRepeatableJobs();

  logger.info(
    {
      queues: Object.values(QUEUE_NAMES),
      concurrency: {
        validation: validationConcurrency,
        processing: processingConcurrency,
        verification: verificationConcurrency,
        reports: reportConcurrency,
      },
      env: env.NODE_ENV,
    },
    'worker started',
  );

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down worker');
    // close() waits for in-flight jobs so nothing is lost mid-flight.
    await Promise.all(workers.map((worker) => worker.close()));
    await closeRuntime();
    await disconnectPrisma().catch(() => undefined);
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => logger.error({ err: reason }, 'unhandled rejection'));
}

main().catch((error: unknown) => {
  logger.fatal({ err: error }, 'worker failed to start');
  process.exit(1);
});
