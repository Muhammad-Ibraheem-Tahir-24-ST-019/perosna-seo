import { env } from '@indexpilot/config';
import { disconnectPrisma } from '@indexpilot/db';
import { buildServer } from './server.js';
import { closeQueues } from './lib/queue.js';
import { logger } from './lib/logger.js';

async function main(): Promise<void> {
  const app = await buildServer();

  await app.listen({ port: env.API_PORT, host: env.API_HOST });
  logger.info(
    { port: env.API_PORT, env: env.NODE_ENV },
    `API listening on http://localhost:${env.API_PORT}`,
  );

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down API');
    // Stop accepting connections first, then release the pools.
    await app.close().catch((error: unknown) => logger.error({ err: error }, 'close failed'));
    await closeQueues().catch(() => undefined);
    await disconnectPrisma().catch(() => undefined);
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, 'unhandled rejection');
  });
  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'uncaught exception');
    void shutdown('uncaughtException');
  });
}

main().catch((error: unknown) => {
  logger.fatal({ err: error }, 'API failed to start');
  process.exit(1);
});
