import { describe, expect, it } from 'vitest';
import { mapIndexNowStatus } from '../../packages/providers/src/discovery/indexnow.js';
import { MockDiscoveryProvider } from '../../packages/providers/src/discovery/mock.js';
import { MockIndexChecker } from '../../packages/providers/src/index-check/checkers.js';
import { SerpApiIndexChecker } from '../../packages/providers/src/index-check/checkers.js';
import { ProviderRegistry } from '../../packages/providers/src/registry.js';
import { MockPaymentProvider, PaymentWebhookError } from '../../packages/providers/src/payments/providers.js';

const submission = {
  urlId: 'url_1',
  url: 'https://example.com/page',
  hostname: 'example.com',
  projectId: 'p1',
  userId: 'u1',
  attemptNumber: 1,
};

describe('IndexNow status mapping', () => {
  it('maps acceptance to SUBMITTED without implying indexing', () => {
    const result = mapIndexNowStatus(200, '');
    expect(result.outcome).toBe('SUBMITTED');
    expect(String(result.metadata?.['note'])).toMatch(/not an indexing guarantee/i);
  });

  it('maps key and host errors to a non-retryable rejection', () => {
    expect(mapIndexNowStatus(403, '')).toMatchObject({ outcome: 'REJECTED', retryable: false });
    expect(mapIndexNowStatus(422, '')).toMatchObject({ outcome: 'REJECTED', retryable: false });
    expect(mapIndexNowStatus(400, '')).toMatchObject({ outcome: 'REJECTED', retryable: false });
  });

  it('maps 429 to a retryable rate-limit outcome', () => {
    expect(mapIndexNowStatus(429, '')).toMatchObject({ outcome: 'RATE_LIMITED', retryable: true });
  });

  it('retries only on server errors', () => {
    expect(mapIndexNowStatus(503, 'boom')).toMatchObject({ outcome: 'ERROR', retryable: true });
    expect(mapIndexNowStatus(418, 'teapot')).toMatchObject({ outcome: 'ERROR', retryable: false });
  });
});

describe('Mock discovery provider', () => {
  it('produces a deterministic outcome for the same URL and attempt', async () => {
    const provider = new MockDiscoveryProvider({ latencyMs: 0 });
    const first = await provider.submit(submission);
    const second = await provider.submit(submission);
    expect(first.outcome).toBe(second.outcome);
    expect(first.reference).toBe(second.reference);
  });

  it('never returns an indexing outcome', async () => {
    const provider = new MockDiscoveryProvider({ latencyMs: 0, failureRate: 0 });
    for (let i = 0; i < 25; i += 1) {
      const result = await provider.submit({ ...submission, urlId: `url_${i}` });
      expect(['SUBMITTED', 'CRAWL_DETECTED']).toContain(result.outcome);
    }
  });

  it('labels its results as simulated', async () => {
    const provider = new MockDiscoveryProvider({ latencyMs: 0, failureRate: 0 });
    const result = await provider.submit(submission);
    expect(result.metadata?.['simulated']).toBe(true);
  });
});

describe('Index checkers', () => {
  it('never returns a hard "not indexed" verdict', async () => {
    const checker = new MockIndexChecker();
    for (let i = 0; i < 20; i += 1) {
      const result = await checker.check(`https://example.com/${i}`);
      expect(['INDEXED_CONFIRMED', 'NOT_CONFIRMED_INDEXED', 'ERROR']).toContain(result.verdict);
      expect(result.confidence).toBeLessThanOrEqual(1);
      expect(result.limitations).toBeTruthy();
    }
  });

  it('reports ERROR rather than guessing when no SERP API is configured', async () => {
    const checker = new SerpApiIndexChecker({});
    const result = await checker.check('https://example.com/page');
    expect(result.verdict).toBe('ERROR');
    expect(result.confidence).toBe(0);
    const health = await checker.healthCheck();
    expect(health.status).toBe('DISABLED');
  });
});

describe('Provider registry', () => {
  const configs = [
    { key: 'mock', name: 'Mock', enabled: true, priority: 10, rateLimitPerMin: 2, dailyLimit: null, settings: {} },
    { key: 'indexnow', name: 'IndexNow', enabled: false, priority: 20, rateLimitPerMin: 60, dailyLimit: null, settings: {} },
  ];

  it('returns only enabled providers, ordered by priority', () => {
    const registry = new ProviderRegistry(configs);
    const available = registry.available();
    expect(available.map((entry) => entry.config.key)).toEqual(['mock']);
  });

  it('drops a provider once its per-minute budget is spent', () => {
    const registry = new ProviderRegistry(configs);
    const now = Date.now();
    registry.consume('mock', now);
    registry.consume('mock', now);
    expect(registry.available(now)).toHaveLength(0);
    // A new window restores the budget.
    expect(registry.available(now + 61_000)).toHaveLength(1);
  });

  it('cools down an unhealthy provider without removing it permanently', () => {
    const registry = new ProviderRegistry(configs);
    const now = Date.now();
    registry.markUnhealthy('mock', 30_000, now);
    expect(registry.available(now)).toHaveLength(0);
    expect(registry.available(now + 31_000)).toHaveLength(1);
  });
});

describe('Mock payment webhooks', () => {
  const provider = new MockPaymentProvider({
    webhookSecret: 'test-secret',
    appUrl: 'http://localhost:3000',
  });

  it('rejects an unsigned webhook', async () => {
    await expect(provider.verifyWebhook('{}', {})).rejects.toBeInstanceOf(PaymentWebhookError);
  });

  it('rejects a tampered payload', async () => {
    const body = JSON.stringify({ id: 'evt_1', type: 'payment.succeeded', paymentId: 'pay_1' });
    const signature = provider.sign(body);
    const tampered = JSON.stringify({ id: 'evt_1', type: 'payment.succeeded', paymentId: 'pay_2' });
    await expect(
      provider.verifyWebhook(tampered, { 'x-mock-signature': signature }),
    ).rejects.toBeInstanceOf(PaymentWebhookError);
  });

  it('accepts a correctly signed payload', async () => {
    const body = JSON.stringify({
      id: 'evt_1',
      type: 'payment.succeeded',
      paymentId: 'pay_1',
      amountCents: 1900,
      currency: 'USD',
    });
    const event = await provider.verifyWebhook(body, { 'x-mock-signature': provider.sign(body) });
    expect(event).toMatchObject({
      providerEventId: 'evt_1',
      type: 'payment.succeeded',
      paymentId: 'pay_1',
      amountCents: 1900,
    });
  });

  it('marks unknown event types as ignored instead of guessing', async () => {
    const body = JSON.stringify({ id: 'evt_2', type: 'something.else' });
    const event = await provider.verifyWebhook(body, { 'x-mock-signature': provider.sign(body) });
    expect(event.type).toBe('ignored');
  });

  it('builds a checkout URL that carries the payment reference', async () => {
    const checkout = await provider.createCheckout({
      userId: 'u1',
      userEmail: 'a@example.com',
      paymentId: 'pay_9',
      packageName: 'Starter',
      credits: 500,
      amountCents: 1900,
      currency: 'USD',
      successUrl: 'http://localhost:3000/billing?status=success',
      cancelUrl: 'http://localhost:3000/billing?status=cancelled',
    });
    expect(checkout.checkoutUrl).toContain('payment=pay_9');
    expect(checkout.providerPaymentId).toMatch(/^mock_/);
  });
});
