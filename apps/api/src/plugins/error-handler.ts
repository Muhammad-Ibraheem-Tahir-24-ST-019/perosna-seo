import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { Prisma } from '@indexpilot/db';
import { env } from '@indexpilot/config';
import { ErrorCodes, isAppError } from '@indexpilot/shared';
import { logger } from '../lib/logger.js';

/**
 * Single error envelope for the whole API:
 *   { error: { code, message, details?, requestId } }
 *
 * Internal failures are logged with their stack and replaced with a generic
 * message; stack traces and driver errors never reach a client.
 */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setNotFoundHandler((request, reply) => {
    void reply.status(404).send({
      error: {
        code: ErrorCodes.NOT_FOUND,
        message: `Route ${request.method} ${request.url.split('?')[0]} does not exist.`,
        requestId: request.id,
      },
    });
  });

  app.setErrorHandler((error, request, reply) => {
    const requestId = request.id;

    if (isAppError(error)) {
      if (!error.expose) {
        logger.error({ err: error, requestId }, 'internal application error');
      }
      return reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message: error.expose ? error.message : 'Something went wrong.',
          ...(error.details !== undefined && error.expose ? { details: error.details } : {}),
          requestId,
        },
      });
    }

    if (error instanceof ZodError) {
      return reply.status(422).send({
        error: {
          code: ErrorCodes.VALIDATION_FAILED,
          message: 'The request payload is invalid.',
          details: error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
          requestId,
        },
      });
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        return reply.status(409).send({
          error: {
            code: ErrorCodes.CONFLICT,
            message: 'That record already exists.',
            requestId,
          },
        });
      }
      if (error.code === 'P2025') {
        return reply.status(404).send({
          error: { code: ErrorCodes.NOT_FOUND, message: 'Resource not found.', requestId },
        });
      }
    }

    const statusCode = (error as { statusCode?: number }).statusCode ?? 500;
    const message = error instanceof Error ? error.message : 'Unexpected error.';

    if (statusCode === 429) {
      return reply.status(429).send({
        error: {
          code: ErrorCodes.RATE_LIMITED,
          message: 'Too many requests. Slow down and try again shortly.',
          requestId,
        },
      });
    }
    if (statusCode === 413) {
      return reply.status(413).send({
        error: {
          code: ErrorCodes.PAYLOAD_TOO_LARGE,
          message: 'The uploaded payload is too large.',
          requestId,
        },
      });
    }
    if (statusCode >= 400 && statusCode < 500) {
      return reply.status(statusCode).send({
        error: {
          code: ErrorCodes.BAD_REQUEST,
          message: message || 'Bad request.',
          requestId,
        },
      });
    }

    logger.error({ err: error, requestId, url: request.url }, 'unhandled error');
    return reply.status(500).send({
      error: {
        code: ErrorCodes.INTERNAL,
        message: 'Something went wrong. The incident has been logged.',
        ...(env.NODE_ENV === 'development' ? { details: { message } } : {}),
        requestId,
      },
    });
  });
}
