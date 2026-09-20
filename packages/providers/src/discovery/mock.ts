import { createHash } from 'node:crypto';
import {
  healthy,
  type DiscoveryProvider,
  type ProviderSubmission,
  type ProviderSubmissionResult,
  type ProviderStatusResult,
} from '../types.js';

export interface MockProviderSettings {
  /** Probability [0..1] that a submission reports a crawl signal. */
  crawlDetectionRate?: number;
  /** Probability [0..1] that a submission fails, to exercise retry paths. */
  failureRate?: number;
  latencyMs?: number;
}

/**
 * Local development provider.
 *
 * It performs NO network work and makes NO claim about search engines. It exists
 * so the whole pipeline (queues, attempts, statuses, credits, refunds, reports)
 * can be exercised end to end without contracting an external service.
 *
 * Outcomes are derived deterministically from the URL id so repeated runs and
 * worker retries produce a stable result.
 */
export class MockDiscoveryProvider implements DiscoveryProvider {
  readonly key = 'mock';
  readonly name = 'Local Mock Discovery';
  readonly kind = 'DISCOVERY' as const;

  private readonly settings: Required<MockProviderSettings>;

  constructor(settings: MockProviderSettings = {}) {
    this.settings = {
      crawlDetectionRate: settings.crawlDetectionRate ?? 0.55,
      failureRate: settings.failureRate ?? 0.05,
      latencyMs: settings.latencyMs ?? 15,
    };
  }

  async validateConfig() {
    return healthy('Mock provider needs no credentials.');
  }

  async healthCheck() {
    return healthy('Mock provider is always available.');
  }

  async submit(input: ProviderSubmission): Promise<ProviderSubmissionResult> {
    if (this.settings.latencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.settings.latencyMs));
    }

    const roll = deterministicRoll(`${input.urlId}:${input.attemptNumber}`);

    if (roll < this.settings.failureRate) {
      return {
        outcome: 'ERROR',
        providerStatus: 'mock_transient_failure',
        errorCode: 'MOCK_TRANSIENT',
        errorMessage: 'Simulated transient provider failure.',
        retryable: true,
        retryAfterMs: 2_000,
      };
    }

    const crawlRoll = deterministicRoll(`crawl:${input.urlId}`);
    const outcome = crawlRoll < this.settings.crawlDetectionRate ? 'CRAWL_DETECTED' : 'SUBMITTED';

    return {
      outcome,
      reference: `mock_${createHash('sha1').update(input.urlId).digest('hex').slice(0, 16)}`,
      providerStatus: outcome === 'CRAWL_DETECTED' ? 'mock_crawl_signal' : 'mock_accepted',
      metadata: {
        note: 'Mock provider: no search engine was contacted and no indexing is implied.',
        simulated: true,
      },
    };
  }

  async getStatus(reference: string): Promise<ProviderStatusResult> {
    return {
      outcome: deterministicRoll(reference) < 0.5 ? 'CRAWL_DETECTED' : 'SUBMITTED',
      providerStatus: 'mock_status',
      metadata: { simulated: true },
    };
  }
}

/** Stable pseudo-random value in [0,1) derived from a seed string. */
function deterministicRoll(seed: string): number {
  const digest = createHash('sha256').update(seed).digest();
  return digest.readUInt32BE(0) / 0xffffffff;
}
