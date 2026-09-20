import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { randomUUID } from 'node:crypto';
import { env } from '@indexpilot/config';
import { prisma } from '@indexpilot/db';
import { API_PREFIX } from '@indexpilot/shared';
import { logger } from './lib/logger.js';
import { authPlugin } from './plugins/auth.js';
import { registerErrorHandler } from './plugins/error-handler.js';
import { accountRoutes } from './routes/account.routes.js';
import { adminRoutes } from './routes/admin.routes.js';
import { authRoutes } from './routes/auth.routes.js';
import { eventRoutes } from './routes/events.routes.js';
import { healthRoutes } from './routes/health.routes.js';
import { projectRoutes } from './routes/projects.routes.js';
import { reportRoutes } from './routes/reports.routes.js';
import { toolRoutes } from './routes/tools.routes.js';
import { urlRoutes } from './routes/urls.routes.js';
import { webhookRoutes } from './routes/webhooks.routes.js';

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({
    // Cast keeps the app's generic parameters at Fastify's defaults so route
    // plugins typed as plain FastifyInstance stay assignable.
    loggerInstance: logger as unknown as FastifyBaseLogger,
    trustProxy: true,
    bodyLimit: 8 * 1024 * 1024,
    genReqId: () => randomUUID(),
    disableRequestLogging: false,
  });

  await app.register(helmet, {
    // The API serves JSON and CSV only; the browser UI is a separate origin.
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-site' },
  });

  await app.register(cors, {
    origin: env.CORS_ORIGINS,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['content-type', 'authorization', 'x-csrf-token', 'idempotency-key'],
    maxAge: 600,
  });

  await app.register(cookie, { secret: env.SESSION_SECRET });

  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
    // preHandler runs after the auth onRequest hook, so request.user is known and
    // signed-in traffic gets a per-user budget; anonymous traffic shares by IP.
    hook: 'preHandler',
    keyGenerator: (request) => request.user?.id ?? request.ip,
    addHeaders: { 'retry-after': true, 'x-ratelimit-limit': true, 'x-ratelimit-remaining': true },
  });

  await app.register(multipart, {
    limits: { fileSize: env.MAX_UPLOAD_BYTES, files: 1, fields: 5 },
  });

  await app.register(authPlugin);
  registerErrorHandler(app);

  // Records API usage for the admin panel without blocking the response.
  app.addHook('onResponse', async (request, reply) => {
    if (!request.url.startsWith(API_PREFIX)) return;
    if (request.url.includes('/health')) return;
    void prisma.apiUsageLog
      .create({
        data: {
          userId: request.user?.id ?? null,
          method: request.method,
          path: request.url.split('?')[0]?.slice(0, 200) ?? '',
          statusCode: reply.statusCode,
          durationMs: Math.round(reply.elapsedTime),
        },
      })
      .catch(() => undefined);
  });

  // Health lives at the root for orchestrators and under the API prefix so the
  // browser can reach it through the same proxy as everything else.
  await app.register(healthRoutes);
  await app.register(
    async (instance) => {
      await instance.register(healthRoutes);
      await instance.register(authRoutes);
      await instance.register(projectRoutes);
      await instance.register(urlRoutes);
      await instance.register(accountRoutes);
      await instance.register(reportRoutes);
      await instance.register(eventRoutes);
      await instance.register(toolRoutes);
      await instance.register(adminRoutes);
    },
    { prefix: API_PREFIX },
  );
  // Webhooks are registered separately: they use a raw-body content parser.
  await app.register(webhookRoutes, { prefix: API_PREFIX });

  app.get('/', async (_request, reply) =>
    reply.send({
      name: env.APP_NAME,
      service: 'api',
      version: '1.0.0',
      docs: '/api/v1',
    }),
  );

  return app;
}
