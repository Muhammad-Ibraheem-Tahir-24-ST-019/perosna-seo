import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuditActions, prisma, recordAudit } from '@indexpilot/db';
import {
  changePassword,
  loginUser,
  registerUser,
  requestPasswordReset,
  resetPassword,
  revokeSession,
  toSessionUser,
  verifyEmail,
} from '../services/auth.service.js';
import { clearSessionCookies, setSessionCookies } from '../plugins/auth.js';
import { emailSchema, parseBody, passwordSchema } from '../lib/validate.js';

export async function authRoutes(app: FastifyInstance): Promise<void> {
  const authLimit = {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  };

  app.post('/auth/register', authLimit, async (request, reply) => {
    const body = parseBody(
      z.object({
        email: emailSchema,
        password: passwordSchema,
        name: z.string().trim().max(120).optional(),
      }),
      request.body,
    );
    const result = await registerUser(body, {
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    });
    setSessionCookies(reply, result.sessionToken, result.csrfToken, result.expiresAt);
    return reply.status(201).send({ user: result.user, csrfToken: result.csrfToken });
  });

  app.post('/auth/login', authLimit, async (request, reply) => {
    const body = parseBody(
      z.object({ email: emailSchema, password: z.string().min(1).max(200) }),
      request.body,
    );
    const result = await loginUser(body, {
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    });
    setSessionCookies(reply, result.sessionToken, result.csrfToken, result.expiresAt);
    return reply.send({ user: result.user, csrfToken: result.csrfToken });
  });

  app.post('/auth/logout', async (request, reply) => {
    if (request.sessionToken) await revokeSession(request.sessionToken);
    clearSessionCookies(reply);
    return reply.send({ ok: true });
  });

  app.get('/auth/me', async (request, reply) => {
    const user = app.requireUser(request);
    const fresh = await prisma.user.findUnique({ where: { id: user.id } });
    if (!fresh) {
      clearSessionCookies(reply);
      return reply.status(401).send({
        error: { code: 'UNAUTHORIZED', message: 'Session is no longer valid.', requestId: request.id },
      });
    }
    const session = await toSessionUser(fresh);
    // resolveSession knows whether this is an impersonated session; re-reading
    // the user row does not, so carry the marker across.
    session.impersonatedBy = user.impersonatedBy ?? null;
    return reply.send({ user: session });
  });

  /**
   * Ends an impersonated session.
   *
   * The admin's own session was replaced when they started impersonating, so
   * this signs them out entirely rather than pretending to "switch back" to a
   * session that no longer exists. That is the honest behaviour and it leaves a
   * clean close on the audit trail.
   */
  app.post('/auth/stop-impersonation', async (request, reply) => {
    const user = app.requireUser(request);
    if (!user.impersonatedBy) {
      return reply.status(400).send({
        error: {
          code: 'BAD_REQUEST',
          message: 'This session is not an impersonation.',
          requestId: request.id,
        },
      });
    }

    if (request.sessionToken) await revokeSession(request.sessionToken);
    clearSessionCookies(reply);
    await recordAudit({
      actorUserId: user.impersonatedBy.id,
      actorEmail: user.impersonatedBy.email,
      action: AuditActions.impersonationEnded,
      entityType: 'user',
      entityId: user.id,
      metadata: { targetEmail: user.email },
      ipAddress: request.ip,
    });
    return reply.send({ ok: true });
  });

  app.post('/auth/forgot-password', authLimit, async (request, reply) => {
    const body = parseBody(z.object({ email: emailSchema }), request.body);
    await requestPasswordReset(body.email);
    // Always the same response: never reveal whether an account exists.
    return reply.send({
      ok: true,
      message: 'If that email is registered, a reset link is on its way.',
    });
  });

  app.post('/auth/reset-password', authLimit, async (request, reply) => {
    const body = parseBody(
      z.object({ token: z.string().min(10).max(500), password: passwordSchema }),
      request.body,
    );
    await resetPassword(body.token, body.password);
    return reply.send({ ok: true });
  });

  app.post('/auth/verify-email', authLimit, async (request, reply) => {
    const body = parseBody(z.object({ token: z.string().min(10).max(500) }), request.body);
    await verifyEmail(body.token);
    return reply.send({ ok: true });
  });

  app.post('/auth/change-password', async (request, reply) => {
    const user = app.requireUser(request);
    const body = parseBody(
      z.object({ currentPassword: z.string().min(1), newPassword: passwordSchema }),
      request.body,
    );
    await changePassword(user.id, body.currentPassword, body.newPassword);
    clearSessionCookies(reply);
    return reply.send({ ok: true, message: 'Password changed. Sign in again.' });
  });

  app.patch('/auth/profile', async (request, reply) => {
    const user = app.requireUser(request);
    const body = parseBody(
      z.object({ name: z.string().trim().max(120).nullable().optional() }),
      request.body,
    );
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { name: body.name ?? null },
    });
    return reply.send({ user: await toSessionUser(updated) });
  });

  app.get('/auth/sessions', async (request, reply) => {
    const user = app.requireUser(request);
    const sessions = await prisma.session.findMany({
      where: { userId: user.id, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastSeenAt: 'desc' },
      take: 20,
      select: {
        id: true,
        userAgent: true,
        ipAddress: true,
        lastSeenAt: true,
        createdAt: true,
        expiresAt: true,
      },
    });
    // Session tokens are never returned - only their metadata.
    return reply.send({ items: sessions });
  });

  app.delete('/auth/sessions/:id', async (request, reply) => {
    const user = app.requireUser(request);
    const { id } = request.params as { id: string };
    await prisma.session.updateMany({
      where: { id, userId: user.id },
      data: { revokedAt: new Date() },
    });
    return reply.send({ ok: true });
  });
}
