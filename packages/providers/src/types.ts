/**
 * Provider contracts.
 *
 * The platform never talks to a discovery service directly: it talks to these
 * interfaces. Provider specific vocabulary is mapped to internal statuses at the
 * adapter boundary, so swapping or adding a provider does not touch the core.
 */

export type ProviderKind = 'DISCOVERY' | 'SEARCH_ENGINE_SUBMISSION' | 'INDEX_CHECK';

export interface HealthResult {
  healthy: boolean;
  status: 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY' | 'DISABLED' | 'UNKNOWN';
  detail?: string;
  checkedAt: string;
}

export interface ProviderSubmission {
  urlId: string;
  url: string;
  hostname: string;
  projectId: string;
  userId: string;
  attemptNumber: number;
  /** Extra hints (sitemap URL, canonical, title) collected during validation. */
  context?: Record<string, unknown>;
}

/**
 * Internal outcome vocabulary.
 *
 * `SUBMITTED` means "the discovery signal was accepted by the provider" - it is
 * explicitly NOT a statement about indexing. Only IndexCheckResult can speak
 * about index state.
 */
export type ProviderOutcome = 'SUBMITTED' | 'CRAWL_DETECTED' | 'REJECTED' | 'RATE_LIMITED' | 'ERROR';

export interface ProviderSubmissionResult {
  outcome: ProviderOutcome;
  /** Provider side identifier used later by getStatus(). */
  reference?: string;
  /** Raw provider status string, kept for debugging. */
  providerStatus?: string;
  errorCode?: string;
  errorMessage?: string;
  /** Hint for the queue: retry this submission later. */
  retryable?: boolean;
  retryAfterMs?: number;
  metadata?: Record<string, unknown>;
}

export interface ProviderStatusResult {
  outcome: ProviderOutcome;
  providerStatus?: string;
  metadata?: Record<string, unknown>;
}

export interface DiscoveryProvider {
  readonly key: string;
  readonly name: string;
  readonly kind: ProviderKind;
  /** Validates credentials/config without performing real work. */
  validateConfig(): Promise<HealthResult>;
  submit(input: ProviderSubmission): Promise<ProviderSubmissionResult>;
  getStatus?(reference: string): Promise<ProviderStatusResult>;
  healthCheck(): Promise<HealthResult>;
}

export interface ProviderRuntimeConfig {
  key: string;
  name: string;
  enabled: boolean;
  priority: number;
  rateLimitPerMin: number;
  dailyLimit: number | null;
  /** Decrypted provider settings. Never leaves the server. */
  settings: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Index verification
// ---------------------------------------------------------------------------

export type SearchEngineKey = 'GOOGLE' | 'BING' | 'YANDEX' | 'NAVER' | 'SEZNAM' | 'OTHER';

export type IndexVerdict = 'INDEXED_CONFIRMED' | 'NOT_CONFIRMED_INDEXED' | 'ERROR';

export interface IndexCheckResult {
  engine: SearchEngineKey;
  /** Human readable method name stored on the check row, e.g. "serp-api". */
  method: string;
  verdict: IndexVerdict;
  /**
   * 0..1. Heuristic lookups (site: queries and similar) are capped well below 1
   * because a negative result does not prove the page is missing from the index.
   */
  confidence: number;
  /** Plain-English caveat shown next to the result in the UI. */
  limitations?: string;
  metadata?: Record<string, unknown>;
  error?: string;
}

export interface IndexChecker {
  readonly key: string;
  readonly engine: SearchEngineKey;
  readonly name: string;
  check(url: string): Promise<IndexCheckResult>;
  healthCheck(): Promise<HealthResult>;
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

export interface CheckoutInput {
  userId: string;
  userEmail: string;
  paymentId: string;
  packageName: string;
  credits: number;
  amountCents: number;
  currency: string;
  successUrl: string;
  cancelUrl: string;
}

export interface CheckoutResult {
  checkoutUrl: string;
  providerPaymentId: string;
}

export interface VerifiedEvent {
  providerEventId: string;
  type: 'payment.succeeded' | 'payment.failed' | 'payment.refunded' | 'ignored';
  providerPaymentId: string | null;
  /** Our own Payment.id, echoed back through provider metadata. */
  paymentId: string | null;
  amountCents: number | null;
  currency: string | null;
  raw: Record<string, unknown>;
}

export interface PaymentResult {
  providerPaymentId: string;
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'REFUNDED' | 'CANCELLED';
  amountCents: number;
  currency: string;
}

export interface RefundResult {
  refunded: boolean;
  providerRefundId?: string;
}

export interface PaymentProvider {
  readonly key: string;
  createCheckout(input: CheckoutInput): Promise<CheckoutResult>;
  verifyWebhook(rawBody: string, headers: Record<string, string | undefined>): Promise<VerifiedEvent>;
  getPayment(providerPaymentId: string): Promise<PaymentResult>;
  refund(providerPaymentId: string, amountCents?: number): Promise<RefundResult>;
  healthCheck(): Promise<HealthResult>;
}

// ---------------------------------------------------------------------------
// Email + storage
// ---------------------------------------------------------------------------

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface EmailProvider {
  readonly key: string;
  send(message: EmailMessage): Promise<void>;
  healthCheck(): Promise<HealthResult>;
}

export interface StoredObject {
  key: string;
  size: number;
}

export interface StorageProvider {
  readonly key: string;
  put(key: string, body: Buffer | string, contentType: string): Promise<StoredObject>;
  get(key: string): Promise<Buffer>;
  /** Returns a URL the browser can use, or null when the API must stream it. */
  getDownloadUrl(key: string, expiresInSeconds: number): Promise<string | null>;
  delete(key: string): Promise<void>;
  healthCheck(): Promise<HealthResult>;
}

export function healthy(detail?: string): HealthResult {
  return { healthy: true, status: 'HEALTHY', detail, checkedAt: new Date().toISOString() };
}

export function unhealthy(detail: string, status: HealthResult['status'] = 'UNHEALTHY'): HealthResult {
  return { healthy: false, status, detail, checkedAt: new Date().toISOString() };
}
