import type { FastifyInstance } from 'fastify';
import { pingDatabase, prisma } from '@indexpilot/db';
import { env } from '@indexpilot/config';
import { getQueueDepths, pingRedis } from '../lib/queue.js';

const startedAt = Date.now();
const VERSION = process.env['npm_package_version'] ?? '1.0.0';

/**
 * Health endpoints.
 *
 * `/health/live` answers "is the process up" (no dependencies touched).
 * `/health/ready` answers "can it serve traffic" (database + Redis).
 * `/health` is the aggregate view used by the admin panel.
 *
 * None of them expose connection strings, credentials or stack traces.
 */
export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health/live', async (_request, reply) => {
    return reply.send({ status: 'ok', uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000) });
  });

  app.get('/health/ready', async (_request, reply) => {
    const [db, redis] = await Promise.all([pingDatabase(), pingRedis()]);
    const ready = db.ok && redis.ok;
    return reply.status(ready ? 200 : 503).send({
      status: ready ? 'ok' : 'down',
      checks: [
        { name: 'database', status: db.ok ? 'ok' : 'down', latencyMs: db.latencyMs },
        { name: 'redis', status: redis.ok ? 'ok' : 'down', latencyMs: redis.latencyMs },
      ],
    });
  });

  app.get('/health', async (_request, reply) => {
    const [db, redis] = await Promise.all([pingDatabase(), pingRedis()]);
    const queues = await getQueueDepths().catch(() => []);

    // A worker is considered alive if it has touched a job record recently.
    const lastJob = await prisma.jobRecord
      .findFirst({ orderBy: { updatedAt: 'desc' }, select: { updatedAt: true } })
      .catch(() => null);
    const workerFresh = lastJob ? Date.now() - lastJob.updatedAt.getTime() < 5 * 60 * 1000 : null;

    const checks = [
      { name: 'database', status: db.ok ? 'ok' : 'down', detail: `${db.latencyMs}ms` },
      { name: 'redis', status: redis.ok ? 'ok' : 'down', detail: `${redis.latencyMs}ms` },
      {
        name: 'workers',
        status: workerFresh === null ? 'degraded' : workerFresh ? 'ok' : 'degraded',
        detail:
          workerFresh === null
            ? 'no jobs processed yet'
            : workerFresh
              ? 'recent job activity'
              : 'no job activity in the last 5 minutes',
      },
      {
        name: 'queue-backlog',
        status: queues.some((queue) => queue.waiting > 10_000) ? 'degraded' : 'ok',
        detail: `${queues.reduce((sum, queue) => sum + queue.waiting, 0)} waiting`,
      },
    ] as const;

    const status = checks.some((check) => check.status === 'down')
      ? 'down'
      : checks.some((check) => check.status === 'degraded')
        ? 'degraded'
        : 'ok';

    return reply.status(status === 'down' ? 503 : 200).send({
      status,
      version: VERSION,
      environment: env.NODE_ENV,
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
      checks,
      queues,
    });
  });
}
