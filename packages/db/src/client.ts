import { PrismaClient } from '@prisma/client';
import { env } from '@indexpilot/config';

declare global {
  // Prevents a new pool per HMR reload in development.
  // eslint-disable-next-line no-var
  var __indexpilotPrisma: PrismaClient | undefined;
}

function createClient(): PrismaClient {
  return new PrismaClient({
    datasources: { db: { url: env.DATABASE_URL } },
    log:
      env.NODE_ENV === 'development'
        ? [{ emit: 'event', level: 'warn' }, { emit: 'event', level: 'error' }]
        : [{ emit: 'event', level: 'error' }],
  });
}

export const prisma: PrismaClient = globalThis.__indexpilotPrisma ?? createClient();

if (env.NODE_ENV !== 'production') {
  globalThis.__indexpilotPrisma = prisma;
}

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}

export async function pingDatabase(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const started = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true, latencyMs: Date.now() - started };
  } catch (error) {
    return { ok: false, latencyMs: Date.now() - started, error: (error as Error).message };
  }
}
