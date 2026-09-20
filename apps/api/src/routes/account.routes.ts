import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { listTransactions, prisma, getOrCreateWallet } from '@indexpilot/db';
import { conflict } from '@indexpilot/shared';
import { getDashboardMetrics } from '../services/dashboard.service.js';
import {
  listPackages,
  listPayments,
  simulateMockPayment,
  startCheckout,
} from '../services/billing.service.js';
import { createApiKey, revokeApiKey } from '../services/auth.service.js';
import { parseBody, parseQuery } from '../lib/validate.js';

export async function accountRoutes(app: FastifyInstance): Promise<void> {
  app.get('/dashboard', async (request, reply) => {
    const user = app.requireUser(request);
    const query = parseQuery(
      z.object({ days: z.coerce.number().int().min(7).max(90).optional() }),
      request.query,
    );
    return reply.send(await getDashboardMetrics(user, query.days ?? 30));
  });

  // -------------------------------------------------------------------------
  // Credits
  // -------------------------------------------------------------------------

  app.get('/credits', async (request, reply) => {
    const user = app.requireUser(request);
    const wallet = await getOrCreateWallet(user.id);
    return reply.send({
      balance: wallet.cachedBalance,
      lifetimeSpent: wallet.lifetimeSpent,
    });
  });

  app.get('/credits/transactions', async (request, reply) => {
    const user = app.requireUser(request);
    const query = parseQuery(
      z.object({
        limit: z.coerce.number().int().min(1).max(100).optional(),
        cursor: z.string().max(64).optional(),
      }),
      request.query,
    );
    const take = query.limit ?? 25;
    const rows = await listTransactions(user.id, {
      take: take + 1,
      ...(query.cursor ? { cursorId: query.cursor } : {}),
    });
    const hasMore = rows.length > take;
    const page = hasMore ? rows.slice(0, take) : rows;
    return reply.send({
      items: page.map((transaction) => ({
        id: transaction.id,
        amount: transaction.amount,
        type: transaction.type,
        description: transaction.description,
        referenceType: transaction.referenceType,
        referenceId: transaction.referenceId,
        balanceAfter: transaction.balanceAfter,
        createdAt: transaction.createdAt.toISOString(),
      })),
      nextCursor: hasMore && page.length > 0 ? (page[page.length - 1]?.id ?? null) : null,
    });
  });

  // -------------------------------------------------------------------------
  // Billing
  // -------------------------------------------------------------------------

  app.get('/billing/packages', async (_request, reply) => {
    return reply.send({ items: await listPackages() });
  });

  app.get('/billing/payments', async (request, reply) => {
    const user = app.requireUser(request);
    return reply.send({ items: await listPayments(user) });
  });

  app.post(
    '/billing/checkout',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const user = app.requireUser(request);
      const body = parseBody(z.object({ packageId: z.string().min(1).max(64) }), request.body);
      return reply.send(await startCheckout(user, body.packageId));
    },
  );

  /** Development only: confirms a mock payment by emitting a signed webhook. */
  app.post('/billing/mock-confirm', async (request, reply) => {
    app.requireUser(request);
    const body = parseBody(z.object({ paymentId: z.string().min(1).max(64) }), request.body);
    const outcome = await simulateMockPayment(body.paymentId);
    return reply.send(outcome);
  });

  // -------------------------------------------------------------------------
  // API keys
  // -------------------------------------------------------------------------

  app.get('/api-keys', async (request, reply) => {
    const user = app.requireUser(request);
    const keys = await prisma.apiKey.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
    });
    // Only the prefix is ever returned; the hash never leaves the database.
    return reply.send({
      items: keys.map((key) => ({
        id: key.id,
        name: key.name,
        keyPrefix: key.keyPrefix,
        lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
        revokedAt: key.revokedAt?.toISOString() ?? null,
        createdAt: key.createdAt.toISOString(),
      })),
    });
  });

  app.post('/api-keys', async (request, reply) => {
    const user = app.requireUser(request);
    const body = parseBody(
      z.object({ name: z.string().trim().min(1).max(60) }),
      request.body,
    );
    const active = await prisma.apiKey.count({ where: { userId: user.id, revokedAt: null } });
    if (active >= 10) throw conflict('You already have 10 active API keys. Revoke one first.');

    const key = await createApiKey(user.id, body.name);
    return reply.status(201).send({
      apiKey: { id: key.id, name: key.name, keyPrefix: key.keyPrefix },
      // Shown exactly once.
      secret: key.secret,
    });
  });

  app.delete('/api-keys/:id', async (request, reply) => {
    const user = app.requireUser(request);
    const { id } = request.params as { id: string };
    await revokeApiKey(user.id, id);
    return reply.send({ ok: true });
  });
}
