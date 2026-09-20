import { CrawlSignalProvider } from './discovery/crawl-signal.js';
import { IndexNowProvider } from './discovery/indexnow.js';
import { MockDiscoveryProvider } from './discovery/mock.js';
import type { DiscoveryProvider, ProviderRuntimeConfig } from './types.js';

export type ProviderFactory = (config: ProviderRuntimeConfig) => DiscoveryProvider;

/**
 * Known adapters. Adding a provider means adding one entry here plus a row in
 * discovery_provider_configs - no core changes.
 */
export const PROVIDER_FACTORIES: Record<string, ProviderFactory> = {
  mock: (config) => new MockDiscoveryProvider(config.settings as Record<string, number>),
  indexnow: (config) => new IndexNowProvider(config.settings as { key?: string; keyLocation?: string }),
  'crawl-signal': (config) => new CrawlSignalProvider(config.settings as { checkSitemap?: boolean }),
  'sitemap-ping': (config) =>
    new CrawlSignalProvider({ ...(config.settings as object), checkSitemap: true }),
};

export function isKnownProvider(key: string): boolean {
  return key in PROVIDER_FACTORIES;
}

interface RateBucket {
  tokens: number;
  windowStartedAt: number;
}

export interface ProviderSelection {
  provider: DiscoveryProvider;
  config: ProviderRuntimeConfig;
}

/**
 * Routes submissions to providers by priority, honouring enabled flags, health
 * and a per-minute rate budget. A provider that fails never blocks the rest: the
 * caller simply moves to the next entry in the ordered list.
 */
export class ProviderRegistry {
  private readonly entries = new Map<string, ProviderSelection>();
  private readonly buckets = new Map<string, RateBucket>();
  private readonly unhealthy = new Map<string, number>();

  constructor(configs: ProviderRuntimeConfig[]) {
    for (const config of configs) {
      const factory = PROVIDER_FACTORIES[config.key];
      if (!factory) continue;
      this.entries.set(config.key, { provider: factory(config), config });
    }
  }

  static fromKeys(keys: string[]): ProviderRegistry {
    return new ProviderRegistry(
      keys.filter(isKnownProvider).map((key, index) => ({
        key,
        name: key,
        enabled: true,
        priority: (index + 1) * 10,
        rateLimitPerMin: 600,
        dailyLimit: null,
        settings: {},
      })),
    );
  }

  get(key: string): DiscoveryProvider | undefined {
    return this.entries.get(key)?.provider;
  }

  all(): ProviderSelection[] {
    return [...this.entries.values()].sort((a, b) => a.config.priority - b.config.priority);
  }

  /** Enabled providers in priority order, skipping rate limited / cooling down ones. */
  available(now = Date.now()): ProviderSelection[] {
    return this.all().filter((entry) => {
      if (!entry.config.enabled) return false;
      const coolingUntil = this.unhealthy.get(entry.config.key);
      if (coolingUntil && coolingUntil > now) return false;
      return this.hasBudget(entry.config, now);
    });
  }

  /** Consumes one rate-limit token for the provider. */
  consume(key: string, now = Date.now()): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    const bucket = this.bucket(entry.config, now);
    bucket.tokens = Math.max(0, bucket.tokens - 1);
  }

  /** Temporarily removes a provider from rotation after repeated failures. */
  markUnhealthy(key: string, cooldownMs = 60_000, now = Date.now()): void {
    this.unhealthy.set(key, now + cooldownMs);
  }

  markHealthy(key: string): void {
    this.unhealthy.delete(key);
  }

  private hasBudget(config: ProviderRuntimeConfig, now: number): boolean {
    return this.bucket(config, now).tokens > 0;
  }

  private bucket(config: ProviderRuntimeConfig, now: number): RateBucket {
    const existing = this.buckets.get(config.key);
    if (!existing || now - existing.windowStartedAt >= 60_000) {
      const fresh: RateBucket = { tokens: Math.max(1, config.rateLimitPerMin), windowStartedAt: now };
      this.buckets.set(config.key, fresh);
      return fresh;
    }
    return existing;
  }
}
