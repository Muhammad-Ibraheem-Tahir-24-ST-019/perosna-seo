import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '@indexpilot/db';
import { notFound } from '@indexpilot/shared';
import { getUrlDetail, listUrls } from '../services/url.service.js';
import { paginationSchema, parseQuery } from '../lib/validate.js';

export async function urlRoutes(app: FastifyInstance): Promise<void> {
  app.get('/urls', async (request, reply) => {
    const user = app.requireUser(request);
    const query = parseQuery(
      paginationSchema.extend({
        projectId: z.string().max(64).optional(),
        status: z.string().max(40).optional(),
        search: z.string().max(200).optional(),
      }),
      request.query,
    );
    return reply.send(
      await listUrls(user, {
        ...(query.projectId ? { projectId: query.projectId } : {}),
        limit: query.limit,
        cursor: query.cursor,
        search: query.search,
        status: query.status as never,
      }),
    );
  });

  app.get('/urls/:id', async (request, reply) => {
    const user = app.requireUser(request);
    const { id } = request.params as { id: string };
    return reply.send({ url: await getUrlDetail(user, id) });
  });

  /**
   * Job status lookup. Jobs are addressed by the URL id the client received at
   * submission time, so an API consumer can poll one endpoint per URL.
   */
  app.get('/jobs/:id', async (request, reply) => {
    const user = app.requireUser(request);
    const { id } = request.params as { id: string };

    const url = await prisma.urlRecord.findUnique({
      where: { id },
      select: {
        id: true,
        userId: true,
        validationStatus: true,
        processingStatus: true,
        verificationStatus: true,
        updatedAt: true,
      },
    });
    if (!url || url.userId !== user.id) throw notFound('Job not found.');

    const jobs = await prisma.jobRecord.findMany({
      where: { entityType: 'url', entityId: id },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    return reply.send({
      id: url.id,
      validationStatus: url.validationStatus,
      processingStatus: url.processingStatus,
      verificationStatus: url.verificationStatus,
      updatedAt: url.updatedAt.toISOString(),
      jobs: jobs.map((job) => ({
        queue: job.queue,
        status: job.status,
        attempts: job.attempts,
        error: job.error,
        createdAt: job.createdAt.toISOString(),
        finishedAt: job.finishedAt?.toISOString() ?? null,
      })),
    });
  });

  app.get('/batches/:id', async (request, reply) => {
    const user = app.requireUser(request);
    const { id } = request.params as { id: string };
    const batch = await prisma.submissionBatch.findUnique({ where: { id } });
    if (!batch || batch.userId !== user.id) throw notFound('Submission batch not found.');
    return reply.send({
      id: batch.id,
      projectId: batch.projectId,
      source: batch.source,
      received: batch.receivedCount,
      accepted: batch.acceptedCount,
      duplicates: batch.duplicateCount,
      invalid: batch.invalidCount,
      creditsCharged: batch.creditsCharged,
      createdAt: batch.createdAt.toISOString(),
      result: batch.resultSnapshot,
    });
  });
}
