import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { env } from '@indexpilot/config';
import { badRequest } from '@indexpilot/shared';
import {
  createProject,
  getProject,
  listProjects,
  updateProject,
} from '../services/project.service.js';
import { listUrls, previewSubmission, submitUrls } from '../services/url.service.js';
import { paginationSchema, parseBody, parseQuery } from '../lib/validate.js';

const MAX_TEXT_BYTES = 5 * 1024 * 1024;

export async function projectRoutes(app: FastifyInstance): Promise<void> {
  app.get('/projects', async (request, reply) => {
    const user = app.requireUser(request);
    const query = parseQuery(
      paginationSchema.extend({ includeArchived: z.coerce.boolean().optional() }),
      request.query,
    );
    return reply.send(await listProjects(user, query));
  });

  app.post('/projects', async (request, reply) => {
    const user = app.requireUser(request);
    const body = parseBody(
      z.object({
        name: z.string().trim().min(1, 'Name is required.').max(120),
        description: z.string().trim().max(1000).optional(),
      }),
      request.body,
    );
    return reply.status(201).send({ project: await createProject(user, body) });
  });

  app.get('/projects/:id', async (request, reply) => {
    const user = app.requireUser(request);
    const { id } = request.params as { id: string };
    return reply.send({ project: await getProject(user, id) });
  });

  app.patch('/projects/:id', async (request, reply) => {
    const user = app.requireUser(request);
    const { id } = request.params as { id: string };
    const body = parseBody(
      z.object({
        name: z.string().trim().min(1).max(120).optional(),
        description: z.string().trim().max(1000).nullable().optional(),
        status: z.enum(['ACTIVE', 'ARCHIVED']).optional(),
      }),
      request.body,
    );
    return reply.send({ project: await updateProject(user, id, body) });
  });

  app.get('/projects/:id/urls', async (request, reply) => {
    const user = app.requireUser(request);
    const { id } = request.params as { id: string };
    const query = parseQuery(
      paginationSchema.extend({
        status: z.string().max(40).optional(),
        search: z.string().max(200).optional(),
      }),
      request.query,
    );
    return reply.send(
      await listUrls(user, {
        projectId: id,
        limit: query.limit,
        cursor: query.cursor,
        search: query.search,
        status: query.status as never,
      }),
    );
  });

  app.post('/projects/:id/urls/preview', async (request, reply) => {
    const user = app.requireUser(request);
    const { id } = request.params as { id: string };
    const body = parseBody(z.object({ urls: z.string().max(MAX_TEXT_BYTES) }), request.body);
    return reply.send(await previewSubmission(id, user, body.urls));
  });

  app.post(
    '/projects/:id/urls',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const user = app.requireUser(request);
      const { id } = request.params as { id: string };
      const body = parseBody(
        z.object({
          urls: z.union([z.string().max(MAX_TEXT_BYTES), z.array(z.string().max(2048)).max(50_000)]),
        }),
        request.body,
      );
      const idempotencyKey = readIdempotencyKey(request.headers['idempotency-key']);

      const result = await submitUrls({
        user,
        projectId: id,
        ...(typeof body.urls === 'string' ? { text: body.urls } : { lines: body.urls }),
        source: request.authMethod === 'api-key' ? 'API' : 'DASHBOARD',
        idempotencyKey,
      });
      return reply.status(202).send(result);
    },
  );

  app.post(
    '/projects/:id/uploads',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const user = app.requireUser(request);
      const { id } = request.params as { id: string };

      const file = await request.file({ limits: { fileSize: env.MAX_UPLOAD_BYTES } });
      if (!file) throw badRequest('No file was uploaded.');

      const filename = file.filename ?? 'upload.txt';
      if (!/\.(txt|csv|tsv)$/i.test(filename)) {
        throw badRequest('Only .txt, .csv and .tsv files are accepted.');
      }

      const buffer = await file.toBuffer();
      if (buffer.byteLength === 0) throw badRequest('The uploaded file is empty.');
      // Content is parsed as text regardless of the declared MIME type: the
      // client-provided type is not trusted.
      const content = buffer.toString('utf8');

      const columnIndexRaw = (file.fields as Record<string, { value?: string } | undefined>)
        ?.['columnIndex']?.value;
      const columnIndex = columnIndexRaw ? Number(columnIndexRaw) : undefined;

      const result = await submitUrls({
        user,
        projectId: id,
        file: {
          filename,
          content,
          ...(columnIndex !== undefined && Number.isInteger(columnIndex) ? { columnIndex } : {}),
        },
        source: 'UPLOAD',
        idempotencyKey: readIdempotencyKey(request.headers['idempotency-key']),
      });
      return reply.status(202).send(result);
    },
  );
}

function readIdempotencyKey(value: string | string[] | undefined): string | null {
  if (!value) return null;
  const key = Array.isArray(value) ? value[0] : value;
  if (!key) return null;
  return key.slice(0, 200);
}
