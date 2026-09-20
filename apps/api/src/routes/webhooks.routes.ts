import type { FastifyInstance } from 'fastify';
import { PaymentWebhookError } from '@indexpilot/providers';
import { AppError, ErrorCodes } from '@indexpilot/shared';
import { handlePaymentWebhook } from '../services/billing.service.js';
import { logger } from '../lib/logger.js';

/**
 * Payment webhooks.
 *
 * The raw body is required for signature verification, so this route opts out of
 * JSON parsing. An invalid signature is rejected before any business logic runs.
 */
export async function webhookRoutes(app: FastifyInstance): Promise<void> {
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (_request, body, done) => {
      done(null, body);
    },
  );

  app.post(
    '/webhooks/payments',
    { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const rawBody = typeof request.body === 'string' ? request.body : JSON.stringify(request.body);
      try {
        const outcome = await handlePaymentWebhook(
          rawBody,
          request.headers as Record<string, string | undefined>,
        );
        return reply.send({ received: true, ...outcome });
      } catch (error) {
        if (error instanceof PaymentWebhookError) {
          logger.warn({ err: error }, 'rejected payment webhook');
          throw new AppError(ErrorCodes.UNAUTHORIZED, 'Webhook signature verification failed.', 401);
        }
        throw error;
      }
    },
  );
}
