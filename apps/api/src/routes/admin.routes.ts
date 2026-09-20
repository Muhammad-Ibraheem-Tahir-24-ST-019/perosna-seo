import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuditActions, prisma, recordAudit } from '@indexpilot/db';
import { notFound } from '@indexpilot/shared';
import {
  adjustUserCredits,
  createCreditPackage,
  deleteCreditPackage,
  forcePasswordReset,
  getAdminOverview,
  getApiUsage,
  getUserDetail,
  listAuditLogs,
  listFailedJobs,
  listProviders,
  listUsers,
  refundPayment,
  setProviderCredentials,
  setUserRole,
  setUserSuspension,
  updateProvider,
} from '../services/admin.service.js';
import {
  createTool,
  deleteTool,
  getToolAnalytics,
  grantToolAccess,
  listToolsForAdmin,
  revokeToolAccess,
  revokeUserSessions,
  seedMissingTools,
  setUserPassword,
  updateTool,
} from '../services/admin-tools.service.js';
import { createImpersonationSession } from '../services/auth.service.js';
import { setSessionCookies } from '../plugins/auth.js';
import { enqueueValidation, getQueue, getQueueDepths } from '../lib/queue.js';
import { parseBody, parseQuery, passwordSchema } from '../lib/validate.js';
import { jobIds, QUEUE_NAMES, type QueueName } from '@indexpilot/shared';

/**
 * Every route in this plugin is gated by requireAdmin. Authorisation lives in
 * the handler, not in whether the UI renders an "Admin" link.
 */
export async function adminRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', async (request) => {
    app.requireAdmin(request);
  });

  app.get('/admin/overview', async (_request, reply) => {
    return reply.send(await getAdminOverview());
  });

  app.get('/admin/users', async (request, reply) => {
    const query = parseQuery(
      z.object({
        search: z.string().max(200).optional(),
        limit: z.coerce.number().int().min(1).max(100).optional(),
        skip: z.coerce.number().int().min(0).optional(),
      }),
      request.query,
    );
    return reply.send(await listUsers(query));
  });

  app.get('/admin/users/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    return reply.send(await getUserDetail(id));
  });

  app.post('/admin/users/:id/suspension', async (request, reply) => {
    const actor = app.requireAdmin(request);
    const { id } = request.params as { id: string };
    const body = parseBody(
      z.object({ suspended: z.boolean(), reason: z.string().trim().min(3).max(500) }),
      request.body,
    );
    return reply.send(await setUserSuspension(actor, id, body.suspended, body.reason));
  });

  app.post('/admin/users/:id/credits', async (request, reply) => {
    const actor = app.requireAdmin(request);
    const { id } = request.params as { id: string };
    const body = parseBody(
      z.object({
        amount: z.number().int().refine((value) => value !== 0, 'Amount cannot be zero.'),
        reason: z.string().trim().min(3, 'A reason is required.').max(500),
      }),
      request.body,
    );
    return reply.send(await adjustUserCredits(actor, id, body.amount, body.reason));
  });

  app.patch('/admin/users/:id/role', async (request, reply) => {
    // Role changes are a super-admin power, not a general admin one.
    const actor = app.requireSuperAdmin(request);
    const { id } = request.params as { id: string };
    const body = parseBody(
      z.object({
        role: z.enum(['USER', 'AGENCY', 'ADMIN', 'SUPER_ADMIN']),
        reason: z.string().trim().min(3, 'A reason is required.').max(500),
      }),
      request.body,
    );
    return reply.send(await setUserRole(actor, id, body.role, body.reason));
  });

  app.post('/admin/users/:id/password-reset', async (request, reply) => {
    const actor = app.requireAdmin(request);
    const { id } = request.params as { id: string };
    const body = parseBody(
      z.object({ reason: z.string().trim().min(3, 'A reason is required.').max(500) }),
      request.body,
    );
    return reply.send(await forcePasswordReset(actor, id, body.reason));
  });

  app.post('/admin/payments/:id/refund', async (request, reply) => {
    const actor = app.requireAdmin(request);
    const { id } = request.params as { id: string };
    const body = parseBody(
      z.object({
        reason: z.string().trim().min(3, 'A reason is required.').max(500),
        allowPartial: z.boolean().optional(),
      }),
      request.body,
    );
    return reply.send(
      await refundPayment(actor, id, body.reason, { allowPartial: body.allowPartial ?? false }),
    );
  });

  /** Sends a URL back through validation and discovery from the start. */
  app.post('/admin/urls/:id/requeue', async (request, reply) => {
    const actor = app.requireAdmin(request);
    const { id } = request.params as { id: string };

    const url = await prisma.urlRecord.findUnique({ where: { id } });
    if (!url) throw notFound('URL not found.');

    await prisma.urlRecord.update({
      where: { id },
      data: {
        validationStatus: 'RECEIVED',
        processingStatus: 'NOT_QUEUED',
        verificationStatus: 'NOT_CHECKED',
        verificationRound: 0,
        nextVerificationAt: null,
      },
    });
    await enqueueValidation([{ urlId: url.id, projectId: url.projectId, userId: url.userId }]);
    await recordAudit({
      actorUserId: actor.id,
      actorEmail: actor.email,
      action: AuditActions.urlRequeued,
      entityType: 'url',
      entityId: id,
    });
    return reply.send({ ok: true, urlId: id });
  });

  app.get('/admin/projects', async (request, reply) => {
    const query = parseQuery(
      z.object({ limit: z.coerce.number().int().min(1).max(100).optional() }),
      request.query,
    );
    const projects = await prisma.project.findMany({
      orderBy: { createdAt: 'desc' },
      take: query.limit ?? 50,
      include: {
        user: { select: { email: true } },
        _count: { select: { urls: true } },
      },
    });
    return reply.send({
      items: projects.map((project) => ({
        id: project.id,
        name: project.name,
        status: project.status,
        owner: project.user.email,
        urls: project._count.urls,
        createdAt: project.createdAt.toISOString(),
      })),
    });
  });

  app.get('/admin/urls', async (request, reply) => {
    const query = parseQuery(
      z.object({
        limit: z.coerce.number().int().min(1).max(200).optional(),
        status: z.string().max(40).optional(),
      }),
      request.query,
    );
    const urls = await prisma.urlRecord.findMany({
      where: query.status ? { processingStatus: query.status as never } : {},
      orderBy: { updatedAt: 'desc' },
      take: query.limit ?? 50,
      include: { user: { select: { email: true } }, project: { select: { name: true } } },
    });
    return reply.send({
      items: urls.map((url) => ({
        id: url.id,
        url: url.normalizedUrl,
        owner: url.user.email,
        project: url.project.name,
        validationStatus: url.validationStatus,
        processingStatus: url.processingStatus,
        verificationStatus: url.verificationStatus,
        updatedAt: url.updatedAt.toISOString(),
      })),
    });
  });

  app.get('/admin/queues', async (_request, reply) => {
    return reply.send({ items: await getQueueDepths() });
  });

  app.get('/admin/jobs/failed', async (request, reply) => {
    const query = parseQuery(
      z.object({ limit: z.coerce.number().int().min(1).max(200).optional() }),
      request.query,
    );
    const jobs = await listFailedJobs(query.limit ?? 50);
    return reply.send({
      items: jobs.map((job) => ({
        id: job.id,
        queue: job.queue,
        bullJobId: job.bullJobId,
        entityType: job.entityType,
        entityId: job.entityId,
        attempts: job.attempts,
        error: job.error,
        updatedAt: job.updatedAt.toISOString(),
      })),
    });
  });

  app.post('/admin/jobs/:id/retry', async (request, reply) => {
    const { id } = request.params as { id: string };
    const record = await prisma.jobRecord.findUnique({ where: { id } });
    if (!record) throw notFound('Job not found.');

    const queueName = record.queue as QueueName;
    const known = Object.values(QUEUE_NAMES).includes(queueName);
    if (!known) throw notFound('Unknown queue.');

    const queue = getQueue(queueName);
    const job = await queue.getJob(record.bullJobId);
    if (job) {
      await job.retry().catch(async () => {
        // A job that is not in a failed state cannot be retried; re-add instead.
        await queue.add(job.name, job.data, {
          jobId: jobIds.retry(record.bullJobId, Date.now()),
        });
      });
    } else {
      await queue.add(
        'retry',
        { urlId: record.entityId },
        { jobId: jobIds.retry(record.bullJobId, Date.now()) },
      );
    }
    await prisma.jobRecord.update({ where: { id }, data: { status: 'QUEUED', error: null } });
    return reply.send({ ok: true });
  });

  app.get('/admin/providers', async (_request, reply) => {
    return reply.send({ items: await listProviders() });
  });

  app.patch('/admin/providers/:id', async (request, reply) => {
    const actor = app.requireAdmin(request);
    const { id } = request.params as { id: string };
    const body = parseBody(
      z.object({
        enabled: z.boolean().optional(),
        priority: z.number().int().min(1).max(1000).optional(),
        rateLimitPerMin: z.number().int().min(1).max(100_000).optional(),
        dailyLimit: z.number().int().min(1).max(10_000_000).nullable().optional(),
      }),
      request.body,
    );
    return reply.send(await updateProvider(actor, id, body));
  });

  app.get('/admin/payments', async (request, reply) => {
    const query = parseQuery(
      z.object({ limit: z.coerce.number().int().min(1).max(200).optional() }),
      request.query,
    );
    const payments = await prisma.payment.findMany({
      orderBy: { createdAt: 'desc' },
      take: query.limit ?? 50,
      include: { user: { select: { email: true } } },
    });
    return reply.send({
      items: payments.map((payment) => ({
        id: payment.id,
        user: payment.user.email,
        provider: payment.provider,
        status: payment.status,
        amountCents: payment.amountCents,
        currency: payment.currency,
        credits: payment.credits,
        createdAt: payment.createdAt.toISOString(),
      })),
    });
  });

  app.get('/admin/audit-logs', async (request, reply) => {
    const query = parseQuery(
      z.object({
        limit: z.coerce.number().int().min(1).max(200).optional(),
        entityType: z.string().max(40).optional(),
      }),
      request.query,
    );
    const logs = await listAuditLogs(query);
    return reply.send({
      items: logs.map((log) => ({
        id: log.id,
        action: log.action,
        entityType: log.entityType,
        entityId: log.entityId,
        actor: log.actor?.email ?? log.actorEmail,
        reason: log.reason,
        metadata: log.metadata,
        createdAt: log.createdAt.toISOString(),
      })),
    });
  });

  app.get('/admin/api-usage', async (request, reply) => {
    const query = parseQuery(
      z.object({ limit: z.coerce.number().int().min(1).max(500).optional() }),
      request.query,
    );
    return reply.send(await getApiUsage(query.limit ?? 100));
  });

  app.get('/admin/credit-packages', async (_request, reply) => {
    const packages = await prisma.creditPackage.findMany({ orderBy: { sortOrder: 'asc' } });
    return reply.send({ items: packages });
  });

  app.post('/admin/credit-packages', async (request, reply) => {
    const actor = app.requireAdmin(request);
    const body = parseBody(
      z.object({
        name: z.string().trim().min(1).max(60),
        credits: z.number().int().min(1),
        priceCents: z.number().int().min(0),
        currency: z.string().trim().length(3).optional(),
        sortOrder: z.number().int().min(0).optional(),
      }),
      request.body,
    );
    return reply.status(201).send({ package: await createCreditPackage(actor, body) });
  });

  app.patch('/admin/credit-packages/:id', async (request, reply) => {
    const actor = app.requireAdmin(request);
    const { id } = request.params as { id: string };
    const body = parseBody(
      z.object({
        name: z.string().trim().min(1).max(60).optional(),
        credits: z.number().int().min(1).optional(),
        priceCents: z.number().int().min(0).optional(),
        enabled: z.boolean().optional(),
        sortOrder: z.number().int().min(0).optional(),
      }),
      request.body,
    );
    const updated = await prisma.creditPackage.update({ where: { id }, data: body });
    await recordAudit({
      actorUserId: actor.id,
      actorEmail: actor.email,
      action: AuditActions.packageUpdated,
      entityType: 'credit_package',
      entityId: id,
      metadata: body as Record<string, unknown>,
    });
    return reply.send({ package: updated });
  });

  app.delete('/admin/credit-packages/:id', async (request, reply) => {
    const actor = app.requireAdmin(request);
    const { id } = request.params as { id: string };
    return reply.send(await deleteCreditPackage(actor, id));
  });

  // --- Impersonation ------------------------------------------------------

  /**
   * Opens a session as another user ("log in as"). The reply swaps the caller's
   * own session cookie for the impersonated one, so the admin's original
   * session is left behind deliberately: they sign back in as themselves when
   * they are done, and the audit trail has a clean start and end.
   */
  app.post('/admin/users/:id/impersonate', async (request, reply) => {
    const actor = app.requireAdmin(request);
    const { id } = request.params as { id: string };
    const result = await createImpersonationSession(actor, id, {
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    });
    setSessionCookies(reply, result.sessionToken, result.csrfToken, result.expiresAt);
    return reply.send({
      user: result.user,
      csrfToken: result.csrfToken,
      expiresAt: result.expiresAt.toISOString(),
    });
  });

  // --- Account controls ---------------------------------------------------

  app.post('/admin/users/:id/password', async (request, reply) => {
    const actor = app.requireAdmin(request);
    const { id } = request.params as { id: string };
    const body = parseBody(
      z.object({
        password: passwordSchema,
        reason: z.string().trim().min(3, 'A reason is required.').max(500),
      }),
      request.body,
    );
    return reply.send(await setUserPassword(actor, id, body.password, body.reason));
  });

  app.post('/admin/users/:id/revoke-sessions', async (request, reply) => {
    const actor = app.requireAdmin(request);
    const { id } = request.params as { id: string };
    const body = parseBody(
      z.object({ reason: z.string().trim().max(500).optional() }),
      request.body,
    );
    return reply.send(await revokeUserSessions(actor, id, body.reason ?? ''));
  });

  // --- Public tool catalogue ---------------------------------------------

  app.get('/admin/tools', async (_request, reply) => {
    return reply.send(await listToolsForAdmin());
  });

  app.get('/admin/tools/analytics', async (request, reply) => {
    const query = parseQuery(
      z.object({ days: z.coerce.number().int().min(1).max(365).optional() }),
      request.query,
    );
    return reply.send(await getToolAnalytics(query.days ?? 30));
  });

  const toolBody = z.object({
    slug: z.string().trim().min(2).max(80),
    name: z.string().trim().min(2).max(80),
    engine: z.enum(['ROBOTS_TXT', 'PAGE_META', 'SITEMAP']),
    headline: z.string().trim().min(2).max(120),
    intro: z.string().trim().min(10).max(600),
    metaTitle: z.string().trim().min(10).max(160),
    metaDescription: z.string().trim().min(20).max(320),
    enabled: z.boolean().optional(),
    requiresAuth: z.boolean().optional(),
    listed: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(10_000).optional(),
  });

  app.post('/admin/tools', async (request, reply) => {
    const actor = app.requireAdmin(request);
    const body = parseBody(toolBody, request.body);
    return reply.status(201).send({ tool: await createTool(actor, body) });
  });

  app.post('/admin/tools/seed', async (request, reply) => {
    const actor = app.requireAdmin(request);
    return reply.send(await seedMissingTools(actor));
  });

  app.patch('/admin/tools/:id', async (request, reply) => {
    const actor = app.requireAdmin(request);
    const { id } = request.params as { id: string };
    const body = parseBody(toolBody.partial(), request.body);
    return reply.send({ tool: await updateTool(actor, id, body) });
  });

  app.delete('/admin/tools/:id', async (request, reply) => {
    const actor = app.requireAdmin(request);
    const { id } = request.params as { id: string };
    return reply.send(await deleteTool(actor, id));
  });

  app.post('/admin/users/:id/tool-access', async (request, reply) => {
    const actor = app.requireAdmin(request);
    const { id } = request.params as { id: string };
    const body = parseBody(
      z.object({
        toolId: z.string().min(1),
        hourlyLimit: z.number().int().min(1).max(100_000).nullable().optional(),
        expiresAt: z.string().datetime().nullable().optional(),
        note: z.string().trim().max(300).optional(),
      }),
      request.body,
    );
    return reply.send({ grant: await grantToolAccess(actor, { userId: id, ...body }) });
  });

  app.delete('/admin/users/:id/tool-access/:toolId', async (request, reply) => {
    const actor = app.requireAdmin(request);
    const { id, toolId } = request.params as { id: string; toolId: string };
    return reply.send(await revokeToolAccess(actor, id, toolId));
  });

  app.put('/admin/providers/:id/credentials', async (request, reply) => {
    // Credentials are a super-admin power and are stored encrypted, never read back.
    const actor = app.requireSuperAdmin(request);
    const { id } = request.params as { id: string };
    const body = parseBody(
      z.object({ settings: z.record(z.string(), z.unknown()).default({}) }),
      request.body,
    );
    return reply.send(await setProviderCredentials(actor, id, body.settings));
  });
}
