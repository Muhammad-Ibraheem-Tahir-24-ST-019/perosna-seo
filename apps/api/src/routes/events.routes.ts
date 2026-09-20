import type { FastifyInstance } from 'fastify';
import { requireOwnedProject, getStatsForProjects } from '../services/project.service.js';

const POLL_INTERVAL_MS = 3_000;
const HEARTBEAT_MS = 20_000;
const MAX_STREAM_MS = 30 * 60 * 1000;

/**
 * Server-Sent Events for live project progress.
 *
 * Ownership is checked before the stream opens, and the stream only ever emits
 * aggregate counters for that one project. The client falls back to polling the
 * REST endpoint if the connection drops, and refetches canonical state on
 * reconnect rather than trusting accumulated deltas.
 */
export async function eventRoutes(app: FastifyInstance): Promise<void> {
  app.get('/projects/:id/events', async (request, reply) => {
    const user = app.requireUser(request);
    const { id } = request.params as { id: string };
    const project = await requireOwnedProject(user, id);

    // Take the socket over: Fastify must not try to serialise a reply for it.
    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });

    let lastPayload = '';
    let closed = false;

    const send = (event: string, data: unknown): void => {
      if (closed) return;
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    const tick = async (): Promise<void> => {
      try {
        const stats = await getStatsForProjects([project.id]);
        const payload = JSON.stringify(stats.get(project.id));
        if (payload !== lastPayload) {
          lastPayload = payload;
          send('stats', { projectId: project.id, stats: JSON.parse(payload) });
        }
      } catch {
        send('error', { message: 'Stats refresh failed; retrying.' });
      }
    };

    send('open', { projectId: project.id, pollIntervalMs: POLL_INTERVAL_MS });
    await tick();

    const statsTimer = setInterval(() => void tick(), POLL_INTERVAL_MS);
    const heartbeatTimer = setInterval(() => {
      if (!closed) reply.raw.write(': heartbeat\n\n');
    }, HEARTBEAT_MS);
    const maxTimer = setTimeout(() => {
      send('reconnect', { reason: 'max-duration' });
      cleanup();
      reply.raw.end();
    }, MAX_STREAM_MS);

    function cleanup(): void {
      if (closed) return;
      closed = true;
      clearInterval(statsTimer);
      clearInterval(heartbeatTimer);
      clearTimeout(maxTimer);
    }

    request.raw.on('close', cleanup);
    request.raw.on('error', cleanup);
  });
}
