import { request } from 'undici';
import { createHash } from 'node:crypto';
import {
  healthy,
  unhealthy,
  type HealthResult,
  type IndexCheckResult,
  type IndexChecker,
  type SearchEngineKey,
} from '../types.js';

/**
 * Index verification.
 *
 * Hard rule for every checker in this file: a *negative* result is reported as
 * NOT_CONFIRMED_INDEXED, never as "not indexed". Public lookups cannot see the
 * whole index, so absence is not evidence of absence - the confidence value and
 * the `limitations` string carry that caveat into the UI and the CSV report.
 */

export interface SerpApiSettings {
  /** Fully qualified endpoint of a licensed SERP data API. */
  endpoint?: string;
  apiKey?: string;
  engine?: SearchEngineKey;
  /** JSON pointer-ish path to the result count, e.g. "search_information.total_results". */
  resultCountPath?: string;
  timeoutMs?: number;
}

/**
 * Generic adapter for a licensed SERP data API.
 *
 * Deliberately not hard-wired to one vendor: point `endpoint` at the provider
 * you have a contract with and map the response with `resultCountPath`. Without
 * credentials it reports DISABLED instead of guessing, so the platform never
 * invents an index verdict.
 */
export class SerpApiIndexChecker implements IndexChecker {
  readonly key = 'serp-api';
  readonly name = 'Licensed SERP data API';
  readonly engine: SearchEngineKey;

  private readonly settings: SerpApiSettings;

  constructor(settings: SerpApiSettings = {}) {
    this.settings = settings;
    this.engine = settings.engine ?? 'GOOGLE';
  }

  async healthCheck(): Promise<HealthResult> {
    if (!this.settings.endpoint || !this.settings.apiKey) {
      return unhealthy('No SERP data API configured; index verification is disabled.', 'DISABLED');
    }
    return healthy('SERP data API credentials present.');
  }

  async check(url: string): Promise<IndexCheckResult> {
    if (!this.settings.endpoint || !this.settings.apiKey) {
      return {
        engine: this.engine,
        method: this.key,
        verdict: 'ERROR',
        confidence: 0,
        error: 'SERP data API is not configured for this deployment.',
        limitations: 'Configure a licensed SERP data API to enable index verification.',
      };
    }

    const endpoint = new URL(this.settings.endpoint);
    endpoint.searchParams.set('q', `site:${stripScheme(url)}`);
    endpoint.searchParams.set('api_key', this.settings.apiKey);

    try {
      const response = await request(endpoint.toString(), {
        method: 'GET',
        signal: AbortSignal.timeout(this.settings.timeoutMs ?? 15_000),
      });
      const text = await response.body.text();
      if (response.statusCode >= 400) {
        return {
          engine: this.engine,
          method: this.key,
          verdict: 'ERROR',
          confidence: 0,
          error: `SERP API returned HTTP ${response.statusCode}.`,
          metadata: { statusCode: response.statusCode },
        };
      }
      const payload: unknown = JSON.parse(text);
      const count = readNumberPath(payload, this.settings.resultCountPath ?? 'search_information.total_results');
      const found = typeof count === 'number' && count > 0;
      return {
        engine: this.engine,
        method: this.key,
        verdict: found ? 'INDEXED_CONFIRMED' : 'NOT_CONFIRMED_INDEXED',
        // Even a positive site: hit is an observation of a public SERP, not a
        // statement from the index itself.
        confidence: found ? 0.8 : 0.4,
        limitations: found
          ? 'Confirmed by a public search result. Coverage of site: queries is incomplete.'
          : 'No public result was returned. site: queries do not reveal the full index, so the page may still be indexed.',
        metadata: { resultCount: count ?? null },
      };
    } catch (error) {
      return {
        engine: this.engine,
        method: this.key,
        verdict: 'ERROR',
        confidence: 0,
        error: (error as Error).message,
      };
    }
  }
}

export interface MockIndexCheckerSettings {
  /** Share of checked URLs that come back confirmed. */
  confirmRate?: number;
  engine?: SearchEngineKey;
}

/**
 * Deterministic local checker used in development and tests.
 *
 * It is labelled as simulated in every result it returns, so a demo environment
 * can never be mistaken for real verification data.
 */
export class MockIndexChecker implements IndexChecker {
  readonly key = 'mock-index-check';
  readonly name = 'Simulated index check (development)';
  readonly engine: SearchEngineKey;

  private readonly confirmRate: number;

  constructor(settings: MockIndexCheckerSettings = {}) {
    this.confirmRate = settings.confirmRate ?? 0.45;
    this.engine = settings.engine ?? 'GOOGLE';
  }

  async healthCheck(): Promise<HealthResult> {
    return healthy('Simulated checker - development only.');
  }

  async check(url: string): Promise<IndexCheckResult> {
    const roll = createHash('sha256').update(url).digest().readUInt32BE(0) / 0xffffffff;
    const confirmed = roll < this.confirmRate;
    return {
      engine: this.engine,
      method: this.key,
      verdict: confirmed ? 'INDEXED_CONFIRMED' : 'NOT_CONFIRMED_INDEXED',
      confidence: confirmed ? 0.5 : 0.3,
      limitations:
        'Simulated result from the development checker. It reflects no real search engine data.',
      metadata: { simulated: true },
    };
  }
}

function stripScheme(url: string): string {
  return url.replace(/^https?:\/\//i, '');
}

function readNumberPath(payload: unknown, path: string): number | null {
  let current: unknown = payload;
  for (const segment of path.split('.')) {
    if (typeof current !== 'object' || current === null) return null;
    current = (current as Record<string, unknown>)[segment];
  }
  if (typeof current === 'number') return current;
  if (typeof current === 'string') {
    const parsed = Number(current.replace(/[^0-9]/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
