import { request } from 'undici';
import {
  healthy,
  unhealthy,
  type DiscoveryProvider,
  type ProviderSubmission,
  type ProviderSubmissionResult,
} from '../types.js';

export interface IndexNowSettings {
  /** The key file contents/name published at keyLocation. */
  key?: string;
  /** Absolute URL of the key file, e.g. https://example.com/<key>.txt */
  keyLocation?: string;
  endpoint?: string;
}

const DEFAULT_ENDPOINT = 'https://api.indexnow.org/indexnow';

/**
 * IndexNow adapter (Bing, Yandex, Seznam and other participating engines).
 *
 * This is a legitimate, documented submission protocol - but it only works for
 * hosts where the customer can publish the key file. Submissions for third
 * party hosts are rejected by the endpoint with HTTP 403/422, which is mapped to
 * REJECTED rather than retried.
 */
export class IndexNowProvider implements DiscoveryProvider {
  readonly key = 'indexnow';
  readonly name = 'IndexNow (Bing / Yandex / Seznam)';
  readonly kind = 'SEARCH_ENGINE_SUBMISSION' as const;

  private readonly settings: IndexNowSettings;

  constructor(settings: IndexNowSettings = {}) {
    this.settings = settings;
  }

  async validateConfig() {
    if (!this.settings.key) {
      return unhealthy('INDEXNOW_KEY is not configured.', 'DISABLED');
    }
    if (!this.settings.keyLocation) {
      return unhealthy('INDEXNOW_KEY_LOCATION is not configured.', 'DEGRADED');
    }
    return healthy('IndexNow key configured.');
  }

  async healthCheck() {
    const config = await this.validateConfig();
    if (!config.healthy) return config;
    try {
      const response = await request(this.endpoint(), {
        method: 'HEAD',
        signal: AbortSignal.timeout(5_000),
      });
      // HEAD has no body; dump() releases the socket without an abort error.
      await response.body.dump().catch(() => undefined);
      return response.statusCode < 500
        ? healthy(`Endpoint responded HTTP ${response.statusCode}.`)
        : unhealthy(`Endpoint responded HTTP ${response.statusCode}.`, 'DEGRADED');
    } catch (error) {
      return unhealthy(`Endpoint unreachable: ${(error as Error).message}`);
    }
  }

  async submit(input: ProviderSubmission): Promise<ProviderSubmissionResult> {
    if (!this.settings.key) {
      return {
        outcome: 'REJECTED',
        errorCode: 'NOT_CONFIGURED',
        errorMessage: 'IndexNow key is not configured for this deployment.',
        retryable: false,
      };
    }

    const payload = {
      host: input.hostname,
      key: this.settings.key,
      ...(this.settings.keyLocation ? { keyLocation: this.settings.keyLocation } : {}),
      urlList: [input.url],
    };

    try {
      const response = await request(this.endpoint(), {
        method: 'POST',
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15_000),
      });
      const body = await response.body.text().catch(() => '');
      return mapIndexNowStatus(response.statusCode, body);
    } catch (error) {
      return {
        outcome: 'ERROR',
        errorCode: 'NETWORK_ERROR',
        errorMessage: (error as Error).message,
        retryable: true,
        retryAfterMs: 30_000,
      };
    }
  }

  private endpoint(): string {
    return this.settings.endpoint ?? DEFAULT_ENDPOINT;
  }
}

/** Maps provider vocabulary onto internal outcomes at the adapter boundary. */
export function mapIndexNowStatus(statusCode: number, body: string): ProviderSubmissionResult {
  const providerStatus = `http_${statusCode}`;
  if (statusCode === 200 || statusCode === 202) {
    return {
      outcome: 'SUBMITTED',
      providerStatus,
      metadata: { note: 'Accepted by IndexNow. Acceptance is not an indexing guarantee.' },
    };
  }
  if (statusCode === 400) {
    return {
      outcome: 'REJECTED',
      providerStatus,
      errorCode: 'BAD_REQUEST',
      errorMessage: 'IndexNow rejected the payload format.',
      retryable: false,
    };
  }
  if (statusCode === 403) {
    return {
      outcome: 'REJECTED',
      providerStatus,
      errorCode: 'KEY_NOT_VALID',
      errorMessage: 'IndexNow key is not valid for this host (key file not found).',
      retryable: false,
    };
  }
  if (statusCode === 422) {
    return {
      outcome: 'REJECTED',
      providerStatus,
      errorCode: 'URL_HOST_MISMATCH',
      errorMessage: 'URLs do not belong to the host, or the key does not match the schema.',
      retryable: false,
    };
  }
  if (statusCode === 429) {
    return {
      outcome: 'RATE_LIMITED',
      providerStatus,
      errorCode: 'RATE_LIMITED',
      errorMessage: 'IndexNow rate limit reached.',
      retryable: true,
      retryAfterMs: 60_000,
    };
  }
  return {
    outcome: 'ERROR',
    providerStatus,
    errorCode: `HTTP_${statusCode}`,
    errorMessage: body.slice(0, 300) || `IndexNow returned HTTP ${statusCode}.`,
    retryable: statusCode >= 500,
    retryAfterMs: 30_000,
  };
}
