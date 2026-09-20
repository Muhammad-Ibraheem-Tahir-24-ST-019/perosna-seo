import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { env } from '@indexpilot/config';
import { constantTimeEquals, forbidden, unauthorized, type SessionUser } from '@indexpilot/shared';
import { resolveApiKey, resolveSession } from '../services/auth.service.js';

export const CSRF_COOKIE = 'ip_csrf';
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

declare module 'fastify' {
  interface FastifyRequest {
    user: SessionUser | null;
    authMethod: 'session' | 'api-key' | null;
    sessionToken: string | null;
  }
  interface FastifyInstance {
    requireUser: (request: FastifyRequest) => SessionUser;
    requireAdmin: (request: FastifyRequest) => SessionUser;
    requireSuperAdmin: (request: FastifyRequest) => SessionUser;
  }
}

/**
 * Authentication.
 *
 * Two credentials are accepted:
 *  - a session cookie (browser). Unsafe methods additionally require a matching
 *    CSRF header, because a cookie is ambient authority.
 *  - an API key bearer token (machine). No CSRF requirement: the credential is
 *    never sent automatically by a browser.
 */
export const authPlugin = fp(async (app: FastifyInstance) => {
  app.decorateRequest('user', null);
  app.decorateRequest('authMethod', null);
  app.decorateRequest('sessionToken', null);

  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const header = request.headers.authorization;
    if (header?.startsWith('Bearer ')) {
      const user = await resolveApiKey(header.slice(7).trim());
      if (user) {
        request.user = user;
        request.authMethod = 'api-key';
        return;
      }
    }

    const token = request.cookies[env.COOKIE_NAME];
    if (!token) return;

    const user = await resolveSession(token);
    if (!user) return;
    request.user = user;
    request.authMethod = 'session';
    request.sessionToken = token;

    if (UNSAFE_METHODS.has(request.method) && !isCsrfExempt(request.url)) {
      const sent = request.headers['x-csrf-token'];
      const cookie = request.cookies[CSRF_COOKIE];
      if (!sent || !cookie || !constantTimeEquals(String(sent), cookie)) {
        return reply.status(403).send({
          error: {
            code: 'FORBIDDEN',
            message: 'Missing or invalid CSRF token. Reload the page and try again.',
            requestId: request.id,
          },
        });
      }
    }
  });

  app.decorate('requireUser', (request: FastifyRequest): SessionUser => {
    if (!request.user) throw unauthorized();
    if (request.user.status === 'SUSPENDED') throw forbidden('This account is suspended.');
    return request.user;
  });

  app.decorate('requireAdmin', (request: FastifyRequest): SessionUser => {
    const user = app.requireUser(request);
    if (user.role !== 'ADMIN' && user.role !== 'SUPER_ADMIN') {
      throw forbidden('Administrator access is required.');
    }
    return user;
  });

  app.decorate('requireSuperAdmin', (request: FastifyRequest): SessionUser => {
    const user = app.requireUser(request);
    if (user.role !== 'SUPER_ADMIN') {
      throw forbidden('Super administrator access is required.');
    }
    return user;
  });
});

/** Login/registration run before a CSRF cookie can exist. */
function isCsrfExempt(url: string): boolean {
  const path = url.split('?')[0] ?? '';
  return (
    path.endsWith('/auth/login') ||
    path.endsWith('/auth/register') ||
    path.endsWith('/auth/forgot-password') ||
    path.endsWith('/auth/reset-password') ||
    path.endsWith('/auth/verify-email') ||
    path.includes('/webhooks/')
  );
}

export function setSessionCookies(
  reply: FastifyReply,
  sessionToken: string,
  csrfToken: string,
  expiresAt: Date,
): void {
  const base = {
    path: '/',
    secure: env.COOKIE_SECURE,
    sameSite: 'lax' as const,
    expires: expiresAt,
    ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
  };
  reply.setCookie(env.COOKIE_NAME, sessionToken, { ...base, httpOnly: true });
  // Readable by the browser on purpose: the SPA echoes it back in a header.
  reply.setCookie(CSRF_COOKIE, csrfToken, { ...base, httpOnly: false });
}

export function clearSessionCookies(reply: FastifyReply): void {
  const base = {
    path: '/',
    secure: env.COOKIE_SECURE,
    sameSite: 'lax' as const,
    ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
  };
  reply.clearCookie(env.COOKIE_NAME, base);
  reply.clearCookie(CSRF_COOKIE, base);
}
