import { Queue, type JobsOptions } from 'bullmq';
import IORedis, { type Redis } from 'ioredis';
import { env } from '@indexpilot/config';
import { ALL_QUEUE_NAMES, jobIds, QUEUE_NAMES, type QueueName } from '@indexpilot/shared';

let connection: Redis | undefined;
const queues = new Map<QueueName, Queue>();

export function getRedis(): Redis {
  connection ??= new IORedis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: false,
  });
  return connection;
}

export function getQueue(name: QueueName): Queue {
  let queue = queues.get(name);
  if (!queue) {
    queue = new Queue(name, {
      connection: getRedis(),
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: { age: 24 * 3600, count: 5_000 },
        removeOnFail: { age: 7 * 24 * 3600 },
      },
    });
    queues.set(name, queue);
  }
  return queue;
}

export interface ValidationJobData {
  urlId: string;
  projectId: string;
  userId: string;
}

export interface ProcessingJobData {
  urlId: string;
  projectId: string;
  userId: string;
  attemptNumber: number;
}

export interface VerificationJobData {
  urlId: string;
  round: number;
}

export interface ReportJobData {
  reportId: string;
}

/**
 * Enqueues validation for a batch of URLs.
 *
 * Deterministic job ids make a duplicate enqueue a no-op instead of a second
 * unit of billable work.
 */
export async function enqueueValidation(
  items: ValidationJobData[],
  options: JobsOptions = {},
): Promise<void> {
  if (items.length === 0) return;
  const queue = getQueue(QUEUE_NAMES.urlValidation);
  await queue.addBulk(
    items.map((data) => ({
      name: 'validate-url',
      data,
      opts: { jobId: jobIds.validateUrl(data.urlId), ...options },
    })),
  );
}

export async function enqueueProcessing(
  data: ProcessingJobData,
  options: JobsOptions = {},
): Promise<void> {
  await getQueue(QUEUE_NAMES.urlProcessing).add('process-url', data, {
    jobId: jobIds.processUrl(data.urlId, data.attemptNumber),
    ...options,
  });
}

export async function enqueueVerification(
  data: VerificationJobData,
  options: JobsOptions = {},
): Promise<void> {
  await getQueue(QUEUE_NAMES.indexVerification).add('verify-url', data, {
    jobId: jobIds.verifyUrl(data.urlId, data.round),
    ...options,
  });
}

export async function enqueueReport(data: ReportJobData, options: JobsOptions = {}): Promise<void> {
  await getQueue(QUEUE_NAMES.reportGeneration).add('generate-report', data, {
    jobId: jobIds.generateReport(data.reportId),
    ...options,
  });
}

export interface QueueDepthSnapshot {
  name: string;
  waiting: number;
  active: number;
  delayed: number;
  completed: number;
  failed: number;
  paused: boolean;
}

export async function getQueueDepths(): Promise<QueueDepthSnapshot[]> {
  return Promise.all(
    ALL_QUEUE_NAMES.map(async (name) => {
      const queue = getQueue(name);
      const counts = await queue.getJobCounts(
        'waiting',
        'active',
        'delayed',
        'completed',
        'failed',
        'paused',
      );
      return {
        name,
        waiting: counts['waiting'] ?? 0,
        active: counts['active'] ?? 0,
        delayed: counts['delayed'] ?? 0,
        completed: counts['completed'] ?? 0,
        failed: counts['failed'] ?? 0,
        paused: (counts['paused'] ?? 0) > 0,
      };
    }),
  );
}

export async function pingRedis(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const started = Date.now();
  try {
    await getRedis().ping();
    return { ok: true, latencyMs: Date.now() - started };
  } catch (error) {
    return { ok: false, latencyMs: Date.now() - started, error: (error as Error).message };
  }
}

export async function closeQueues(): Promise<void> {
  await Promise.all([...queues.values()].map((queue) => queue.close()));
  queues.clear();
  if (connection) {
    await connection.quit().catch(() => undefined);
    connection = undefined;
  }
}
