import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  createReport,
  downloadReport,
  getReport,
  listReports,
  REPORT_FILTERS,
} from '../services/report.service.js';
import { parseBody } from '../lib/validate.js';

export async function reportRoutes(app: FastifyInstance): Promise<void> {
  app.get('/reports', async (request, reply) => {
    const user = app.requireUser(request);
    return reply.send({ items: await listReports(user) });
  });

  app.post(
    '/reports',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const user = app.requireUser(request);
      const body = parseBody(
        z.object({
          projectId: z.string().max(64).optional(),
          filter: z.enum(REPORT_FILTERS).default('all'),
        }),
        request.body,
      );
      const report = await createReport(user, {
        ...(body.projectId ? { projectId: body.projectId } : {}),
        filter: body.filter,
      });
      return reply.status(202).send({ report });
    },
  );

  app.get('/reports/:id', async (request, reply) => {
    const user = app.requireUser(request);
    const { id } = request.params as { id: string };
    return reply.send({ report: await getReport(user, id) });
  });

  app.get('/reports/:id/download', async (request, reply) => {
    const user = app.requireUser(request);
    const { id } = request.params as { id: string };
    const file = await downloadReport(user, id);
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="${file.filename}"`)
      .send(file.body);
  });
}
