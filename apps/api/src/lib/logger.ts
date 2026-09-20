import { pino, type Logger } from 'pino';
import { env } from '@indexpilot/config';

/**
 * Structured logging.
 *
 * Redaction matters here: submitted URLs routinely carry tokens in their query
 * string, and auth headers/cookies must never reach the log sink.
 */
export const logger: Logger = pino({
  level: env.LOG_LEVEL,
  base: { service: 'api', env: env.NODE_ENV },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-csrf-token"]',
      'res.headers["set-cookie"]',
      'password',
      '*.password',
      '*.passwordHash',
      '*.token',
      '*.apiKey',
      '*.secret',
    ],
    censor: '[redacted]',
  },
  ...(env.NODE_ENV === 'development'
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname,service,env' },
        },
      }
    : {}),
});

/** Query strings can contain session tokens; keep only scheme://host/path in logs. */
export function safeUrlForLog(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}${parsed.search ? '?[query-redacted]' : ''}`;
  } catch {
    return '[unparseable-url]';
  }
}
