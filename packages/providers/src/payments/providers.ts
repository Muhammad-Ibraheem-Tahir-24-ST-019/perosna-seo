import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { request } from 'undici';
import {
  healthy,
  unhealthy,
  type CheckoutInput,
  type CheckoutResult,
  type HealthResult,
  type PaymentProvider,
  type PaymentResult,
  type RefundResult,
  type VerifiedEvent,
} from '../types.js';

export class PaymentWebhookError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaymentWebhookError';
  }
}

export interface MockPaymentSettings {
  webhookSecret: string;
  appUrl: string;
}

/**
 * Local payment provider.
 *
 * Checkout returns an in-app confirmation page instead of a hosted payment form.
 * Webhooks are signed with the same HMAC scheme as the real adapter so the
 * signature verification and idempotency paths are exercised in development.
 */
export class MockPaymentProvider implements PaymentProvider {
  readonly key = 'mock';
  private readonly settings: MockPaymentSettings;

  constructor(settings: MockPaymentSettings) {
    this.settings = settings;
  }

  async healthCheck(): Promise<HealthResult> {
    return healthy('Mock payment provider (no real charges).');
  }

  async createCheckout(input: CheckoutInput): Promise<CheckoutResult> {
    const providerPaymentId = `mock_${randomUUID()}`;
    const url = new URL('/billing/mock-checkout', this.settings.appUrl);
    url.searchParams.set('payment', input.paymentId);
    url.searchParams.set('provider_payment', providerPaymentId);
    url.searchParams.set('credits', String(input.credits));
    url.searchParams.set('amount', String(input.amountCents));
    return { checkoutUrl: url.toString(), providerPaymentId };
  }

  async verifyWebhook(
    rawBody: string,
    headers: Record<string, string | undefined>,
  ): Promise<VerifiedEvent> {
    const signature = headers['x-mock-signature'] ?? headers['X-Mock-Signature'];
    if (!signature) throw new PaymentWebhookError('Missing x-mock-signature header.');
    const expected = createHmac('sha256', this.settings.webhookSecret).update(rawBody).digest('hex');
    if (!safeEqual(signature, expected)) {
      throw new PaymentWebhookError('Invalid webhook signature.');
    }

    const payload = JSON.parse(rawBody) as Record<string, unknown>;
    const type = String(payload['type'] ?? '');
    return {
      providerEventId: String(payload['id'] ?? randomUUID()),
      type:
        type === 'payment.succeeded'
          ? 'payment.succeeded'
          : type === 'payment.refunded'
            ? 'payment.refunded'
            : type === 'payment.failed'
              ? 'payment.failed'
              : 'ignored',
      providerPaymentId: (payload['providerPaymentId'] as string | undefined) ?? null,
      paymentId: (payload['paymentId'] as string | undefined) ?? null,
      amountCents: (payload['amountCents'] as number | undefined) ?? null,
      currency: (payload['currency'] as string | undefined) ?? 'USD',
      raw: payload,
    };
  }

  async getPayment(providerPaymentId: string): Promise<PaymentResult> {
    return { providerPaymentId, status: 'PENDING', amountCents: 0, currency: 'USD' };
  }

  async refund(providerPaymentId: string): Promise<RefundResult> {
    return { refunded: true, providerRefundId: `mock_refund_${providerPaymentId}` };
  }

  /** Test/dev helper: produces the signature header for a payload. */
  sign(rawBody: string): string {
    return createHmac('sha256', this.settings.webhookSecret).update(rawBody).digest('hex');
  }
}

export interface StripeSettings {
  secretKey: string;
  webhookSecret: string;
  apiBase?: string;
  toleranceSeconds?: number;
}

/**
 * Stripe adapter implemented directly against the REST API so the core carries
 * no vendor SDK. Business logic never imports this class: it goes through
 * PaymentProvider.
 */
export class StripePaymentProvider implements PaymentProvider {
  readonly key = 'stripe';
  private readonly settings: StripeSettings;

  constructor(settings: StripeSettings) {
    this.settings = settings;
  }

  async healthCheck(): Promise<HealthResult> {
    if (!this.settings.secretKey) return unhealthy('STRIPE_SECRET_KEY is not set.', 'DISABLED');
    try {
      const response = await this.call('GET', '/v1/balance');
      return response.statusCode < 400
        ? healthy('Stripe API reachable.')
        : unhealthy(`Stripe API returned HTTP ${response.statusCode}.`, 'DEGRADED');
    } catch (error) {
      return unhealthy(`Stripe API unreachable: ${(error as Error).message}`);
    }
  }

  async createCheckout(input: CheckoutInput): Promise<CheckoutResult> {
    const form = new URLSearchParams();
    form.set('mode', 'payment');
    form.set('success_url', input.successUrl);
    form.set('cancel_url', input.cancelUrl);
    form.set('customer_email', input.userEmail);
    form.set('client_reference_id', input.paymentId);
    form.set('metadata[paymentId]', input.paymentId);
    form.set('metadata[userId]', input.userId);
    form.set('metadata[credits]', String(input.credits));
    form.set('line_items[0][quantity]', '1');
    form.set('line_items[0][price_data][currency]', input.currency.toLowerCase());
    form.set('line_items[0][price_data][unit_amount]', String(input.amountCents));
    form.set('line_items[0][price_data][product_data][name]', `${input.packageName} - ${input.credits} credits`);

    const response = await this.call('POST', '/v1/checkout/sessions', form.toString());
    const body = (await response.body.json()) as Record<string, unknown>;
    if (response.statusCode >= 400) {
      throw new Error(`Stripe checkout failed: ${JSON.stringify(body).slice(0, 300)}`);
    }
    return {
      checkoutUrl: String(body['url']),
      providerPaymentId: String(body['id']),
    };
  }

  async verifyWebhook(
    rawBody: string,
    headers: Record<string, string | undefined>,
  ): Promise<VerifiedEvent> {
    const header = headers['stripe-signature'];
    if (!header) throw new PaymentWebhookError('Missing stripe-signature header.');

    const parts = Object.fromEntries(
      header.split(',').map((part) => {
        const [key, value] = part.split('=');
        return [key?.trim() ?? '', value?.trim() ?? ''];
      }),
    );
    const timestamp = parts['t'];
    const signature = parts['v1'];
    if (!timestamp || !signature) throw new PaymentWebhookError('Malformed stripe-signature header.');

    const tolerance = this.settings.toleranceSeconds ?? 300;
    const age = Math.abs(Date.now() / 1000 - Number(timestamp));
    if (!Number.isFinite(age) || age > tolerance) {
      throw new PaymentWebhookError('Webhook timestamp outside tolerance window.');
    }

    const expected = createHmac('sha256', this.settings.webhookSecret)
      .update(`${timestamp}.${rawBody}`)
      .digest('hex');
    if (!safeEqual(signature, expected)) {
      throw new PaymentWebhookError('Invalid webhook signature.');
    }

    const event = JSON.parse(rawBody) as Record<string, unknown>;
    const data = (event['data'] as Record<string, unknown> | undefined)?.['object'] as
      | Record<string, unknown>
      | undefined;
    const metadata = (data?.['metadata'] as Record<string, string> | undefined) ?? {};
    const eventType = String(event['type'] ?? '');

    let type: VerifiedEvent['type'] = 'ignored';
    if (eventType === 'checkout.session.completed' || eventType === 'checkout.session.async_payment_succeeded') {
      type = 'payment.succeeded';
    } else if (eventType === 'checkout.session.async_payment_failed' || eventType === 'payment_intent.payment_failed') {
      type = 'payment.failed';
    } else if (eventType === 'charge.refunded') {
      type = 'payment.refunded';
    }

    return {
      providerEventId: String(event['id']),
      type,
      providerPaymentId: data?.['id'] ? String(data['id']) : null,
      paymentId: metadata['paymentId'] ?? (data?.['client_reference_id'] ? String(data['client_reference_id']) : null),
      amountCents: typeof data?.['amount_total'] === 'number' ? (data['amount_total'] as number) : null,
      currency: data?.['currency'] ? String(data['currency']).toUpperCase() : null,
      raw: event,
    };
  }

  async getPayment(providerPaymentId: string): Promise<PaymentResult> {
    const response = await this.call('GET', `/v1/checkout/sessions/${providerPaymentId}`);
    const body = (await response.body.json()) as Record<string, unknown>;
    const paid = body['payment_status'] === 'paid';
    return {
      providerPaymentId,
      status: paid ? 'SUCCEEDED' : body['status'] === 'expired' ? 'CANCELLED' : 'PENDING',
      amountCents: typeof body['amount_total'] === 'number' ? (body['amount_total'] as number) : 0,
      currency: String(body['currency'] ?? 'usd').toUpperCase(),
    };
  }

  async refund(providerPaymentId: string, amountCents?: number): Promise<RefundResult> {
    const form = new URLSearchParams();
    form.set('payment_intent', providerPaymentId);
    if (amountCents !== undefined) form.set('amount', String(amountCents));
    const response = await this.call('POST', '/v1/refunds', form.toString());
    const body = (await response.body.json()) as Record<string, unknown>;
    return { refunded: response.statusCode < 400, providerRefundId: String(body['id'] ?? '') };
  }

  private call(method: 'GET' | 'POST', path: string, body?: string) {
    return request(`${this.settings.apiBase ?? 'https://api.stripe.com'}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.settings.secretKey}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body,
      signal: AbortSignal.timeout(20_000),
    });
  }
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
