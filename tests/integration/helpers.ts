import { randomUUID } from 'node:crypto';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { prisma, pingDatabase } from '../../packages/db/src/index.js';

/**
 * Integration tests need PostgreSQL and Redis. When either is unreachable the
 * suites are skipped with a visible reason instead of failing the unit run.
 */
export async function infrastructureAvailable(): Promise<boolean> {
  const db = await pingDatabase();
  if (!db.ok) return false;
  try {
    const { pingRedis } = await import('../../apps/api/src/lib/queue.js');
    const redis = await pingRedis();
    return redis.ok;
  } catch {
    return false;
  }
}

export function uniqueEmail(prefix = 'it'): string {
  return `${prefix}-${randomUUID().slice(0, 8)}@example.com`;
}

export interface TestClient {
  cookies: Record<string, string>;
  csrf: string | null;
  request: (options: {
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    url: string;
    payload?: unknown;
    headers?: Record<string, string>;
    withCsrf?: boolean;
  }) => Promise<LightMyRequestResponse>;
}

let clientCounter = 0;

/**
 * Each client gets its own source IP so the (real, intentional) per-IP signup
 * rate limit does not make the suite order-dependent.
 */
export function nextClientIp(): string {
  clientCounter += 1;
  return `203.0.${Math.floor(clientCounter / 250) + 1}.${(clientCounter % 250) + 1}`;
}

/** Minimal cookie jar over Fastify's inject(), mirroring what a browser sends. */
export function createClient(app: FastifyInstance, remoteAddress = nextClientIp()): TestClient {
  const client: TestClient = {
    cookies: {},
    csrf: null,
    async request({ method, url, payload, headers = {}, withCsrf = true }) {
      const cookieHeader = Object.entries(client.cookies)
        .map(([name, value]) => `${name}=${value}`)
        .join('; ');
      const response = await app.inject({
        method,
        url,
        remoteAddress,
        ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}),
        headers: {
          ...(cookieHeader ? { cookie: cookieHeader } : {}),
          ...(withCsrf && client.csrf && method !== 'GET' ? { 'x-csrf-token': client.csrf } : {}),
          ...headers,
        },
      });
      for (const cookie of response.cookies) {
        if (cookie.value === '' || (cookie.expires && cookie.expires.getTime() < Date.now())) {
          delete client.cookies[cookie.name];
        } else {
          client.cookies[cookie.name] = cookie.value;
        }
        if (cookie.name === 'ip_csrf') client.csrf = cookie.value || null;
      }
      return response;
    },
  };
  return client;
}

export async function registerClient(
  app: FastifyInstance,
  email = uniqueEmail(),
  password = 'Integration-pass-123',
): Promise<{ client: TestClient; userId: string; email: string }> {
  const client = createClient(app);
  const response = await client.request({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { email, password },
  });
  if (response.statusCode !== 201) {
    throw new Error(`register failed: ${response.statusCode} ${response.body}`);
  }
  return { client, userId: response.json().user.id as string, email };
}

export async function makeAdmin(userId: string): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { role: 'ADMIN' } });
}

export { prisma };
