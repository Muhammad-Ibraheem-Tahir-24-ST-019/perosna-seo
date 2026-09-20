import { createHash } from 'node:crypto';
import IORedis, { type Redis } from 'ioredis';
import { env } from '@indexpilot/config';
import { logger } from './logger.js';

/**
 * Short-lived result cache for the public SEO tools.
 *
 * Two jobs, both from the build brief:
 *  - politeness: ten people checking the same popular domain should hit that
 *    site once, not ten times;
 *  - cost: a cached hit costs a Redis GET instead of an outbound fetch.
 *
 * Redis being unavailable must never take the tools down — a cache miss is
 * always a correct answer, so every operation here degrades to "no cache".
 */

const PREFIX = 'tools:cache:';

/**
 * A dedicated connection, deliberately not the BullMQ one.
 *
 * BullMQ requires `maxRetriesPerRequest: null`, which makes ioredis queue
 * commands indefinitely while the server is unreachable rather than failing
 * them. That is right for a job queue and wrong here: it would turn "Redis is
 * down" into a public endpoint that hangs instead of one that skips the cache.
 * These settings make a command fail fast so the fallbacks below can run.
 */
let client: Redis | undefined;

function cacheRedis(): Redis {
  if (client) return client;

  const connection = new IORedis(env.REDIS_URL, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    enableReadyCheck: false,
    connectTimeout: 1_000,
    commandTimeout: 1_000,
    lazyConnect: true,
    // Back off quickly but keep trying, so the cache recovers on its own once
    // Redis comes back.
    retryStrategy: (times) => Math.min(times * 500, 5_000),
  });

  // Attached once, at construction: an ioredis 'error' event with no listener
  // is an unhandled error that takes the process down, and re-attaching one per
  // call would leak listeners until Node warns about it.
  connection.on('error', (error: Error) => {
    logger.debug({ err: error }, 'tool cache redis unavailable');
  });

  client = connection;
  return connection;
}

/** Belt and braces: never let a Redis call outlive the request it serves. */
async function withTimeout<T>(operation: Promise<T>, ms = 1_500): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('redis timeout')), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function keyFor(tool: string, input: string): string {
  // The input is a user-supplied URL, which can be long and contain characters
  // that are awkward in a Redis key; hash it and keep the tool name readable.
  const digest = createHash('sha256').update(input).digest('hex').slice(0, 40);
  return `${PREFIX}${tool}:${digest}`;
}

export interface CachedEntry<T> {
  value: T;
  /** Seconds since the entry was written. */
  ageSeconds: number;
}

export async function readCache<T>(tool: string, input: string): Promise<CachedEntry<T> | null> {
  if (env.TOOLS_CACHE_TTL_SECONDS <= 0) return null;
  const key = keyFor(tool, input);
  try {
    const redis = cacheRedis();
    const [raw, ttl] = await withTimeout(Promise.all([redis.get(key), redis.ttl(key)]));
    if (raw === null) return null;
    const value = JSON.parse(raw) as T;
    const ageSeconds =
      ttl > 0 ? Math.max(0, env.TOOLS_CACHE_TTL_SECONDS - ttl) : env.TOOLS_CACHE_TTL_SECONDS;
    return { value, ageSeconds };
  } catch (error) {
    logger.debug({ err: error, key }, 'tool cache read failed; treating as a miss');
    return null;
  }
}

export async function writeCache(tool: string, input: string, value: unknown): Promise<void> {
  if (env.TOOLS_CACHE_TTL_SECONDS <= 0) return;
  try {
    await withTimeout(
      cacheRedis().set(
        keyFor(tool, input),
        JSON.stringify(value),
        'EX',
        env.TOOLS_CACHE_TTL_SECONDS,
      ),
    );
  } catch (error) {
    logger.debug({ err: error }, 'tool cache write failed; result still returned');
  }
}

/**
 * Fixed-window counter used for the public tools' own rate limit.
 *
 * This sits *in addition to* the global Fastify rate limiter: that one protects
 * the API, this one protects the sites being checked, and the two have very
 * different budgets. Failing open on a Redis outage is deliberate — the global
 * limiter is still in force underneath.
 */
export interface RateVerdict {
  allowed: boolean;
  remaining: number;
  limit: number;
  resetSeconds: number;
}

export async function consumeToolQuota(identity: string, limit: number): Promise<RateVerdict> {
  const windowSeconds = 3600;
  // Bucket by hour so the key rotates without needing a sweep.
  const bucket = Math.floor(Date.now() / 1000 / windowSeconds);
  const key = `tools:rate:${identity}:${bucket}`;
  try {
    const redis = cacheRedis();
    const used = await withTimeout(redis.incr(key));
    if (used === 1) await withTimeout(redis.expire(key, windowSeconds));
    const ttl = await withTimeout(redis.ttl(key));
    return {
      allowed: used <= limit,
      remaining: Math.max(0, limit - used),
      limit,
      resetSeconds: ttl > 0 ? ttl : windowSeconds,
    };
  } catch (error) {
    logger.debug({ err: error }, 'tool rate limiter unavailable; allowing request');
    return { allowed: true, remaining: limit, limit, resetSeconds: windowSeconds };
  }
}
