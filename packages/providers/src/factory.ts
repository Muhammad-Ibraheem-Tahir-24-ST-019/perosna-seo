import { env, resolveFromRoot } from '@indexpilot/config';
import { DEFAULT_SSRF_POLICY } from '@indexpilot/validation';
import { LogEmailProvider, SmtpEmailProvider } from './email/providers.js';
import { MockIndexChecker, SerpApiIndexChecker } from './index-check/checkers.js';
import { MockPaymentProvider, StripePaymentProvider } from './payments/providers.js';
import { ProviderRegistry } from './registry.js';
import { LocalStorageProvider, S3StorageProvider } from './storage/providers.js';
import type {
  EmailProvider,
  IndexChecker,
  PaymentProvider,
  ProviderRuntimeConfig,
  StorageProvider,
} from './types.js';

let emailProvider: EmailProvider | undefined;
let storageProvider: StorageProvider | undefined;
let paymentProvider: PaymentProvider | undefined;
let indexChecker: IndexChecker | undefined;

export function createEmailProvider(): EmailProvider {
  emailProvider ??=
    env.EMAIL_DRIVER === 'smtp'
      ? new SmtpEmailProvider({
          host: env.SMTP_HOST,
          port: env.SMTP_PORT,
          secure: env.SMTP_SECURE,
          user: env.SMTP_USER,
          password: env.SMTP_PASSWORD,
          from: env.EMAIL_FROM,
        })
      : new LogEmailProvider();
  return emailProvider;
}

export function createStorageProvider(): StorageProvider {
  storageProvider ??=
    env.STORAGE_DRIVER === 's3'
      ? new S3StorageProvider({
          endpoint: env.S3_ENDPOINT,
          region: env.S3_REGION,
          bucket: env.S3_BUCKET,
          accessKeyId: env.S3_ACCESS_KEY_ID ?? '',
          secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? '',
          forcePathStyle: env.S3_FORCE_PATH_STYLE,
        })
      : // Anchored to the workspace root so the API and the worker - which run
        // from different working directories - share one storage folder.
        new LocalStorageProvider(resolveFromRoot(env.STORAGE_LOCAL_DIR));
  return storageProvider;
}

export function createPaymentProvider(): PaymentProvider {
  paymentProvider ??=
    env.PAYMENT_DRIVER === 'stripe'
      ? new StripePaymentProvider({
          secretKey: env.STRIPE_SECRET_KEY ?? '',
          webhookSecret: env.STRIPE_WEBHOOK_SECRET ?? '',
        })
      : new MockPaymentProvider({
          webhookSecret: env.PAYMENT_WEBHOOK_SECRET,
          appUrl: env.APP_URL,
        });
  return paymentProvider;
}

/**
 * Index verification adapter.
 *
 * Without a licensed SERP data API the platform uses the simulated checker in
 * development and reports ERROR (never a fabricated verdict) in production.
 */
export function createIndexChecker(): IndexChecker {
  if (indexChecker) return indexChecker;
  const endpoint = process.env['SERP_API_ENDPOINT'];
  const apiKey = process.env['SERP_API_KEY'];
  if (endpoint && apiKey) {
    indexChecker = new SerpApiIndexChecker({
      endpoint,
      apiKey,
      resultCountPath: process.env['SERP_API_RESULT_PATH'],
    });
  } else if (env.NODE_ENV === 'production') {
    indexChecker = new SerpApiIndexChecker({});
  } else {
    indexChecker = new MockIndexChecker();
  }
  return indexChecker;
}

/** Builds the runtime config for a discovery provider row from the database. */
export function toRuntimeConfig(row: {
  key: string;
  name: string;
  enabled: boolean;
  priority: number;
  rateLimitPerMin: number;
  dailyLimit: number | null;
  settings?: Record<string, unknown>;
}): ProviderRuntimeConfig {
  const settings = { ...(row.settings ?? {}) };
  if (row.key === 'indexnow') {
    settings['key'] ??= env.INDEXNOW_KEY;
    settings['keyLocation'] ??= env.INDEXNOW_KEY_LOCATION;
  }
  if (row.key === 'crawl-signal' || row.key === 'sitemap-ping') {
    settings['policy'] ??= {
      ...DEFAULT_SSRF_POLICY,
      allowPrivateNetwork: env.ALLOW_PRIVATE_NETWORK_FETCH,
    };
    settings['userAgent'] ??= env.FETCH_USER_AGENT;
    settings['timeoutMs'] ??= env.FETCH_TIMEOUT_MS;
  }
  return {
    key: row.key,
    name: row.name,
    enabled: row.enabled,
    priority: row.priority,
    rateLimitPerMin: row.rateLimitPerMin,
    dailyLimit: row.dailyLimit,
    settings,
  };
}

/** Fallback registry used when the database has no provider rows yet. */
export function createDefaultRegistry(): ProviderRegistry {
  return ProviderRegistry.fromKeys(env.DEFAULT_DISCOVERY_PROVIDERS);
}

/** Test helper: clears the memoised singletons. */
export function resetProviderSingletons(): void {
  emailProvider = undefined;
  storageProvider = undefined;
  paymentProvider = undefined;
  indexChecker = undefined;
}
