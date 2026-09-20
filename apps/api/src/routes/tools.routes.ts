import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { env } from '@indexpilot/config';
import { forbidden, notFound, unauthorized } from '@indexpilot/shared';
import { parseBody } from '../lib/validate.js';
import { consumeToolQuota } from '../lib/tool-cache.js';
import { getTool, hasToolGrant, listTools } from '../services/tool-catalog.service.js';
import {
  recordToolRun,
  runMetaTool,
  runRobotsTool,
  runSitemapTool,
  type ToolMeta,
} from '../services/tools.service.js';

/**
 * The public SEO micro-tools.
 *
 * Unlike the rest of `/api/v1`, these endpoints are usable without an account —
 * that is the whole point of them as an acquisition channel. Everything that
 * would normally be enforced by authentication is therefore enforced here
 * explicitly: a per-IP hourly quota on top of the global limiter, a hard cap on
 * how much work one call may do, and an audit row per run.
 */
export async function toolRoutes(app: FastifyInstance): Promise<void> {
  if (!env.TOOLS_ENABLED) return;

  app.get('/tools', async (_request, reply) => {
    const tools = await listTools();
    return reply.send({
      items: tools
        .filter((tool) => tool.listed)
        .map((tool) => ({
          slug: tool.slug,
          name: tool.name,
          engine: tool.engine,
          headline: tool.headline,
          intro: tool.intro,
          requiresAuth: tool.requiresAuth,
        })),
    });
  });

  app.get('/tools/:slug', async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const tool = await getTool(slug);
    if (!tool.enabled) throw notFound('That tool is not available.');
    return reply.send({
      tool: {
        slug: tool.slug,
        name: tool.name,
        engine: tool.engine,
        headline: tool.headline,
        intro: tool.intro,
        metaTitle: tool.metaTitle,
        metaDescription: tool.metaDescription,
        requiresAuth: tool.requiresAuth,
      },
    });
  });

  const runSchema = z.object({
    url: z.string().trim().min(1, 'Enter a URL or domain.').max(2048),
    /** Which landing page this run came from, so we can see what people use. */
    slug: z.string().trim().max(80).optional(),
  });

  app.post('/tools/robots', async (request, reply) => {
    const body = parseBody(
      runSchema.extend({
        paths: z.array(z.string().trim().max(2048)).max(25).optional(),
        userAgent: z.string().trim().max(120).optional(),
      }),
      request.body,
    );
    const gate = await authorise(request, reply, body.slug ?? 'robots-txt-tester');
    if (!gate) return reply;

    try {
      const { result, meta } = await runRobotsTool(body.url, {
        paths: body.paths,
        userAgent: body.userAgent,
      });
      finish(gate, request, result.finalUrl, meta, {
        outcome: result.error ? 'FETCH_FAILED' : 'COMPLETED',
        issueCount: result.audit.issues.length,
      });
      return reply.send({ result, meta, quota: gate.quota });
    } catch (error) {
      failed(gate, request, body.url, error);
      throw error;
    }
  });

  app.post('/tools/meta', async (request, reply) => {
    const body = parseBody(runSchema, request.body);
    const gate = await authorise(request, reply, body.slug ?? 'meta-checker');
    if (!gate) return reply;

    try {
      const { result, meta } = await runMetaTool(body.url);
      const issueCount = result.report
        ? [result.report.title, result.report.description, result.report.canonical, result.report.headings].filter(
            (field) => field.verdict !== 'good',
          ).length
        : 0;
      finish(gate, request, result.finalUrl, meta, {
        outcome: result.error ? 'FETCH_FAILED' : 'COMPLETED',
        issueCount,
      });
      return reply.send({ result, meta, quota: gate.quota });
    } catch (error) {
      failed(gate, request, body.url, error);
      throw error;
    }
  });

  app.post('/tools/sitemap', async (request, reply) => {
    const body = parseBody(
      runSchema.extend({ checkUrls: z.boolean().optional() }),
      request.body,
    );
    const gate = await authorise(request, reply, body.slug ?? 'sitemap-checker');
    if (!gate) return reply;

    // The URL-status pass is the expensive part and the one that touches the
    // target site hardest, so signed-in accounts get a bigger budget.
    const urlCheckLimit = gate.userId
      ? env.TOOLS_SITEMAP_URL_LIMIT_USER
      : env.TOOLS_SITEMAP_URL_LIMIT_ANON;

    try {
      const { result, meta } = await runSitemapTool(body.url, {
        urlCheckLimit,
        checkUrls: body.checkUrls,
      });
      finish(gate, request, result.sitemapUrl ?? body.url, meta, {
        outcome: result.error ? 'FETCH_FAILED' : 'COMPLETED',
        issueCount: result.issues.length + result.summary.brokenCount,
      });
      return reply.send({ result, meta, quota: gate.quota });
    } catch (error) {
      failed(gate, request, body.url, error);
      throw error;
    }
  });
}

interface Gate {
  slug: string;
  toolId: string | null;
  engine: 'ROBOTS_TXT' | 'PAGE_META' | 'SITEMAP';
  userId: string | null;
  quota: { remaining: number; limit: number; resetSeconds: number };
  startedAt: number;
}

/**
 * Resolves the tool, enforces access and spends one unit of quota.
 *
 * Returns null when the request has already been answered (rate limited), so
 * the caller can bail out without sending twice.
 */
async function authorise(
  request: FastifyRequest,
  reply: FastifyReply,
  slug: string,
): Promise<Gate | null> {
  const tool = await getTool(slug);
  if (!tool.enabled) throw notFound('That tool is not available.');

  const userId = request.user?.id ?? null;

  if (tool.requiresAuth) {
    if (!userId) throw unauthorized('This tool requires an account. Sign in to continue.');
    const granted = await hasToolGrant(userId, tool.id);
    // Admins always have access; everyone else needs an explicit grant.
    const isAdmin = request.user?.role === 'ADMIN' || request.user?.role === 'SUPER_ADMIN';
    if (!granted && !isAdmin) {
      throw forbidden('Your account does not have access to this tool yet.');
    }
  }

  const identity = userId ? `user:${userId}` : `ip:${request.ip}`;
  const limit = userId ? env.TOOLS_RATE_LIMIT_USER_PER_HOUR : env.TOOLS_RATE_LIMIT_ANON_PER_HOUR;
  const verdict = await consumeToolQuota(identity, limit);

  reply.header('x-tool-quota-limit', String(verdict.limit));
  reply.header('x-tool-quota-remaining', String(verdict.remaining));

  if (!verdict.allowed) {
    recordToolRun({
      toolSlug: tool.slug,
      toolId: tool.id,
      engine: tool.engine,
      userId,
      ip: request.ip,
      targetHost: null,
      outcome: 'RATE_LIMITED',
      cached: false,
      issueCount: 0,
      durationMs: 0,
    });
    reply.header('retry-after', String(verdict.resetSeconds));
    await reply.status(429).send({
      error: {
        code: 'RATE_LIMITED',
        message: userId
          ? `You have used all ${verdict.limit} checks for this hour. The limit resets in ${Math.ceil(verdict.resetSeconds / 60)} minutes.`
          : `You have used all ${verdict.limit} free checks for this hour. Create a free account for a higher limit, or try again in ${Math.ceil(verdict.resetSeconds / 60)} minutes.`,
      },
    });
    return null;
  }

  return {
    slug: tool.slug,
    toolId: tool.id,
    engine: tool.engine,
    userId,
    quota: {
      remaining: verdict.remaining,
      limit: verdict.limit,
      resetSeconds: verdict.resetSeconds,
    },
    startedAt: Date.now(),
  };
}

function hostOf(value: string): string | null {
  try {
    return new URL(value).host;
  } catch {
    return null;
  }
}

function finish(
  gate: Gate,
  request: FastifyRequest,
  target: string,
  meta: ToolMeta,
  extra: { outcome: 'COMPLETED' | 'FETCH_FAILED'; issueCount: number },
): void {
  recordToolRun({
    toolSlug: gate.slug,
    toolId: gate.toolId,
    engine: gate.engine,
    userId: gate.userId,
    ip: request.ip,
    targetHost: hostOf(target),
    outcome: extra.outcome,
    cached: meta.cached,
    issueCount: extra.issueCount,
    durationMs: Date.now() - gate.startedAt,
  });
}

function failed(gate: Gate, request: FastifyRequest, target: string, error: unknown): void {
  const status = (error as { statusCode?: number })?.statusCode;
  recordToolRun({
    toolSlug: gate.slug,
    toolId: gate.toolId,
    engine: gate.engine,
    userId: gate.userId,
    ip: request.ip,
    targetHost: hostOf(target),
    outcome: status === 400 ? 'INVALID_INPUT' : 'FETCH_FAILED',
    cached: false,
    issueCount: 0,
    durationMs: Date.now() - gate.startedAt,
  });
}
