import { safeFetch, SafeFetchError, type SsrfPolicy } from '@indexpilot/validation';
import {
  healthy,
  type DiscoveryProvider,
  type ProviderSubmission,
  type ProviderSubmissionResult,
} from '../types.js';

export interface CrawlSignalSettings {
  policy?: SsrfPolicy;
  timeoutMs?: number;
  maxBodyBytes?: number;
  userAgent?: string;
  /** Also look the URL up in the host's sitemap to record a discoverability signal. */
  checkSitemap?: boolean;
}

/**
 * Crawl-readiness signal provider.
 *
 * What it actually does, stated plainly: it re-requests the URL with the
 * platform crawler, records freshness headers, and (optionally) checks whether
 * the URL is listed in the host's sitemap. That produces real, verifiable
 * discoverability signals for the report.
 *
 * What it does NOT do: contact a search engine, or imply that the page will be
 * indexed. The best outcome it can return is SUBMITTED / CRAWL_DETECTED.
 */
export class CrawlSignalProvider implements DiscoveryProvider {
  readonly key = 'crawl-signal';
  readonly name = 'Crawl Readiness Signals';
  readonly kind = 'DISCOVERY' as const;

  private readonly settings: CrawlSignalSettings;

  constructor(settings: CrawlSignalSettings = {}) {
    this.settings = settings;
  }

  async validateConfig() {
    return healthy('No credentials required; uses the platform SSRF-safe fetcher.');
  }

  async healthCheck() {
    return healthy('Operational.');
  }

  async submit(input: ProviderSubmission): Promise<ProviderSubmissionResult> {
    try {
      const response = await safeFetch(input.url, {
        policy: this.settings.policy,
        timeoutMs: this.settings.timeoutMs ?? 10_000,
        maxBodyBytes: this.settings.maxBodyBytes ?? 65_536,
        userAgent: this.settings.userAgent,
        method: 'GET',
      });

      if (response.status >= 400) {
        return {
          outcome: 'REJECTED',
          providerStatus: `http_${response.status}`,
          errorCode: `HTTP_${response.status}`,
          errorMessage: `The page returned HTTP ${response.status} during the crawl signal request.`,
          retryable: response.status >= 500,
          retryAfterMs: 60_000,
        };
      }

      const sitemap = this.settings.checkSitemap
        ? await findInSitemap(input.url, this.settings)
        : null;

      return {
        outcome: sitemap?.found ? 'CRAWL_DETECTED' : 'SUBMITTED',
        reference: `crawl_${input.urlId}_${input.attemptNumber}`,
        providerStatus: `http_${response.status}`,
        metadata: {
          httpStatus: response.status,
          lastModified: response.headers['last-modified'] ?? null,
          etag: response.headers['etag'] ?? null,
          cacheControl: response.headers['cache-control'] ?? null,
          responseTimeMs: response.durationMs,
          sitemapChecked: Boolean(this.settings.checkSitemap),
          listedInSitemap: sitemap?.found ?? null,
          sitemapUrl: sitemap?.sitemapUrl ?? null,
          note: 'Crawl readiness signal only. No search engine was contacted.',
        },
      };
    } catch (error) {
      const fetchError = error instanceof SafeFetchError ? error : null;
      return {
        outcome: fetchError?.code === 'SSRF_BLOCKED' ? 'REJECTED' : 'ERROR',
        errorCode: fetchError?.code ?? 'NETWORK_ERROR',
        errorMessage: fetchError?.message ?? (error as Error).message,
        retryable: fetchError?.code !== 'SSRF_BLOCKED',
        retryAfterMs: 60_000,
      };
    }
  }
}

async function findInSitemap(
  targetUrl: string,
  settings: CrawlSignalSettings,
): Promise<{ found: boolean; sitemapUrl: string | null }> {
  try {
    const url = new URL(targetUrl);
    const sitemapUrl = new URL('/sitemap.xml', url.origin).toString();
    const response = await safeFetch(sitemapUrl, {
      policy: settings.policy,
      timeoutMs: settings.timeoutMs ?? 10_000,
      maxBodyBytes: 512 * 1024,
      userAgent: settings.userAgent,
    });
    if (response.status >= 400) return { found: false, sitemapUrl: null };
    return { found: response.body.includes(url.pathname), sitemapUrl };
  } catch {
    return { found: false, sitemapUrl: null };
  }
}
