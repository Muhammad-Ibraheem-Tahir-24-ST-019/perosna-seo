import IORedis, { type Redis } from 'ioredis';
import { pino, type Logger } from 'pino';
import { Queue, type JobsOptions } from 'bullmq';
import { env } from '@indexpilot/config';
import { prisma, type JobStatus } from '@indexpilot/db';
import { QUEUE_NAMES, type QueueName } from '@indexpilot/shared';
import {
  createDefaultRegistry,
  ProviderRegistry,
  toRuntimeConfig,
} from '@indexpilot/providers';
import { DEFAULT_SSRF_POLICY, type SsrfPolicy } from '@indexpilot/validation';

export const logger: Logger = pino({
  level: env.LOG_LEVEL,
  base: { service: 'worker', env: env.NODE_ENV },
  redact: {
    paths: ['*.password', '*.passwordHash', '*.token', '*.apiKey', '*.secret'],
    censor: '[redacted]',
  },
  ...(env.NODE_ENV === 'development'
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname,service,env' },
        },
      }
    : {}),
});

let connection: Redis | undefined;
const queues = new Map<QueueName, Queue>();

export function getConnection(): Redis {
  connection ??= new IORedis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
  return connection;
}

export function getQueue(name: QueueName): Queue {
  let queue = queues.get(name);
  if (!queue) {
    queue = new Queue(name, { connection: getConnection() });
    queues.set(name, queue);
  }
  return queue;
}

export async function closeRuntime(): Promise<void> {
  await Promise.all([...queues.values()].map((queue) => queue.close()));
  queues.clear();
  if (connection) {
    await connection.quit().catch(() => undefined);
    connection = undefined;
  }
}

/** SSRF policy used by every worker-side fetch. */
export function fetchPolicy(): SsrfPolicy {
  return { ...DEFAULT_SSRF_POLICY, allowPrivateNetwork: env.ALLOW_PRIVATE_NETWORK_FETCH };
}

export const fetchOptions = {
  policy: fetchPolicy(),
  timeoutMs: env.FETCH_TIMEOUT_MS,
  maxRedirects: env.FETCH_MAX_REDIRECTS,
  maxBodyBytes: env.FETCH_MAX_BODY_BYTES,
  userAgent: env.FETCH_USER_AGENT,
};

// ---------------------------------------------------------------------------
// Provider registry (refreshed from the database so admin toggles take effect
// without a redeploy)
// ---------------------------------------------------------------------------

let registry: ProviderRegistry | undefined;
let registryLoadedAt = 0;
const REGISTRY_TTL_MS = 30_000;

export async function getRegistry(force = false): Promise<ProviderRegistry> {
  if (!force && registry && Date.now() - registryLoadedAt < REGISTRY_TTL_MS) {
    return registry;
  }
  try {
    const rows = await prisma.discoveryProviderConfig.findMany({ orderBy: { priority: 'asc' } });
    if (rows.length === 0) {
      registry = createDefaultRegistry();
    } else {
      registry = new ProviderRegistry(
        rows.map((row) =>
          toRuntimeConfig({
            key: row.key,
            name: row.name,
            enabled: row.enabled,
            priority: row.priority,
            rateLimitPerMin: row.rateLimitPerMin,
            dailyLimit: row.dailyLimit,
          }),
        ),
      );
    }
  } catch (error) {
    logger.error({ err: error }, 'failed to load provider configuration; using defaults');
    registry ??= createDefaultRegistry();
  }
  registryLoadedAt = Date.now();
  return registry;
}

// ---------------------------------------------------------------------------
// Job bookkeeping - gives the admin panel a durable view of queue work
// ---------------------------------------------------------------------------

export async function trackJob(
  queue: QueueName,
  bullJobId: string,
  entityType: string,
  entityId: string,
  status: JobStatus,
  extra: { attempts?: number; error?: string | null } = {},
): Promise<void> {
  try {
    await prisma.jobRecord.upsert({
      where: { queue_bullJobId: { queue, bullJobId } },
      create: {
        queue,
        bullJobId,
        entityType,
        entityId,
        status,
        attempts: extra.attempts ?? 0,
        error: extra.error ?? null,
        startedAt: status === 'ACTIVE' ? new Date() : null,
        finishedAt: status === 'COMPLETED' || status === 'FAILED' ? new Date() : null,
      },
      update: {
        status,
        attempts: extra.attempts ?? undefined,
        error: extra.error ?? null,
        ...(status === 'ACTIVE' ? { startedAt: new Date() } : {}),
        ...(status === 'COMPLETED' || status === 'FAILED' ? { finishedAt: new Date() } : {}),
      },
    });
  } catch (error) {
    logger.warn({ err: error, queue, bullJobId }, 'failed to record job state');
  }
}

export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: { age: 24 * 3600, count: 5_000 },
  removeOnFail: { age: 7 * 24 * 3600 },
};

export { QUEUE_NAMES };
