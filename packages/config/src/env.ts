import { existsSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

/**
 * Walks up from this file until it finds the workspace root `.env` so that every
 * app/worker/test process reads exactly the same configuration.
 */
let workspaceRoot = process.cwd();

function loadDotEnv(): void {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i += 1) {
    const candidate = resolve(dir, '.env');
    if (existsSync(candidate)) {
      dotenv.config({ path: candidate });
      workspaceRoot = dir;
      return;
    }
    // pnpm-workspace.yaml marks the root even when no .env exists (production).
    if (existsSync(resolve(dir, 'pnpm-workspace.yaml'))) {
      workspaceRoot = dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  dotenv.config();
}

/**
 * Directory that relative paths in configuration resolve against.
 *
 * Without this, a relative path like STORAGE_LOCAL_DIR would mean a different
 * folder in the API process (cwd apps/api) than in the worker (cwd apps/worker),
 * and reports written by one would be invisible to the other.
 */
export function getWorkspaceRoot(): string {
  return workspaceRoot;
}

/** Resolves a possibly-relative configured path against the workspace root. */
export function resolveFromRoot(path: string): string {
  return isAbsolute(path) ? path : resolve(workspaceRoot, path);
}

loadDotEnv();

const bool = (defaultValue: boolean) =>
  z
    .enum(['true', 'false', '1', '0', ''])
    .optional()
    .transform((value) => {
      if (value === undefined || value === '') return defaultValue;
      return value === 'true' || value === '1';
    });

const int = (defaultValue: number, min = 0) =>
  z.coerce.number().int().min(min).default(defaultValue);

const csv = (defaultValue: string[]) =>
  z
    .string()
    .optional()
    .transform((value) =>
      (value ?? '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    )
    .transform((items) => (items.length > 0 ? items : defaultValue));

export const envSchema = z.object({
  // APP
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_NAME: z.string().min(1).default('IndexPilot'),
  APP_URL: z.string().url().default('http://localhost:3000'),
  API_PORT: int(4000, 1),
  API_HOST: z.string().default('0.0.0.0'),
  CORS_ORIGINS: csv(['http://localhost:3000']),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  // DATABASE
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  // REDIS / QUEUES
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),
  WORKER_CONCURRENCY_VALIDATION: int(10, 1),
  WORKER_CONCURRENCY_PROCESSING: int(10, 1),
  WORKER_CONCURRENCY_VERIFICATION: int(5, 1),
  WORKER_CONCURRENCY_REPORTS: int(2, 1),
  VERIFICATION_FIRST_DELAY_HOURS: int(24, 0),
  VERIFICATION_RECHECK_HOURS: int(72, 1),
  VERIFICATION_MAX_CHECKS: int(4, 1),

  // AUTH
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  SESSION_TTL_HOURS: int(720, 1),
  COOKIE_NAME: z.string().default('ip_session'),
  COOKIE_SECURE: bool(false),
  COOKIE_DOMAIN: z
    .string()
    .optional()
    .transform((value) => (value && value.length > 0 ? value : undefined)),
  ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'ENCRYPTION_KEY must be 64 hex characters (32 bytes)'),

  // FETCH / SSRF
  FETCH_TIMEOUT_MS: int(10_000, 500),
  FETCH_MAX_REDIRECTS: int(5, 0),
  FETCH_MAX_BODY_BYTES: int(524_288, 1024),
  FETCH_USER_AGENT: z.string().default('IndexPilotBot/1.0'),
  ALLOW_PRIVATE_NETWORK_FETCH: bool(false),

  // LIMITS
  MAX_URLS_PER_SUBMISSION: int(10_000, 1),
  MAX_UPLOAD_BYTES: int(10_485_760, 1024),
  CREDITS_PER_URL: int(1, 0),
  SIGNUP_BONUS_CREDITS: int(50, 0),

  // PUBLIC SEO TOOLS
  // These endpoints are unauthenticated and fetch third-party URLs on demand,
  // so every limit here is an abuse control, not a product knob.
  TOOLS_ENABLED: bool(true),
  /** Anonymous requests per IP per hour, across all tools. */
  TOOLS_RATE_LIMIT_ANON_PER_HOUR: int(60, 1),
  /** Signed-in requests per account per hour. */
  TOOLS_RATE_LIMIT_USER_PER_HOUR: int(600, 1),
  /** How long a fetched result is reused, so repeat checks do not re-hit the target site. */
  TOOLS_CACHE_TTL_SECONDS: int(900, 0),
  TOOLS_FETCH_TIMEOUT_MS: int(10_000, 500),
  /** URL-status checks per sitemap run. Caps us as a DDoS vector against the target. */
  TOOLS_SITEMAP_URL_LIMIT_ANON: int(100, 1),
  TOOLS_SITEMAP_URL_LIMIT_USER: int(500, 1),
  /** Parallel status checks against a single target host. */
  TOOLS_SITEMAP_CONCURRENCY: int(6, 1),

  // STORAGE
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('./tmp/storage'),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().default('indexpilot-reports'),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: bool(true),

  // EMAIL
  EMAIL_DRIVER: z.enum(['log', 'smtp']).default('log'),
  EMAIL_FROM: z.string().default('no-reply@indexpilot.local'),
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: int(1025, 1),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_SECURE: bool(false),

  // PAYMENTS
  PAYMENT_DRIVER: z.enum(['mock', 'stripe']).default('mock'),
  PAYMENT_WEBHOOK_SECRET: z.string().min(8).default('dev-webhook-secret'),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),

  // PROVIDERS
  DEFAULT_DISCOVERY_PROVIDERS: csv(['mock']),
  INDEXNOW_KEY: z.string().optional(),
  INDEXNOW_KEY_LOCATION: z.string().optional(),

  // OBSERVABILITY
  SENTRY_DSN: z.string().optional(),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

/** Validates process.env and fails fast with a readable message. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(
      `Invalid environment configuration:\n${details}\n\nCopy .env.example to .env and fill in the missing values.`,
    );
  }
  const value = parsed.data;
  if (value.NODE_ENV === 'production') {
    if (value.ALLOW_PRIVATE_NETWORK_FETCH) {
      throw new Error('ALLOW_PRIVATE_NETWORK_FETCH must be false in production (SSRF risk).');
    }
    if (value.SESSION_SECRET.includes('change-me')) {
      throw new Error('SESSION_SECRET still uses the development placeholder value.');
    }
    if (/^0+$/.test(value.ENCRYPTION_KEY)) {
      throw new Error('ENCRYPTION_KEY still uses the development placeholder value.');
    }
  }
  return value;
}

export const env: Env = (() => {
  cached ??= loadEnv();
  return cached;
})();

export const isProduction = (): boolean => env.NODE_ENV === 'production';
export const isDevelopment = (): boolean => env.NODE_ENV === 'development';
export const isTest = (): boolean => env.NODE_ENV === 'test';
