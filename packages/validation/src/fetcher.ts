import { Agent, request as undiciRequest } from 'undici';
import {
  DEFAULT_SSRF_POLICY,
  SsrfError,
  assertUrlIsFetchable,
  type SsrfPolicy,
} from './ssrf.js';

export type FetchErrorCode =
  | 'SSRF_BLOCKED'
  | 'TIMEOUT'
  | 'TOO_MANY_REDIRECTS'
  | 'INVALID_REDIRECT'
  | 'NETWORK_ERROR'
  | 'RESPONSE_TOO_LARGE';

export class SafeFetchError extends Error {
  readonly code: FetchErrorCode;
  readonly detail?: string;
  constructor(code: FetchErrorCode, message: string, detail?: string) {
    super(message);
    this.name = 'SafeFetchError';
    this.code = code;
    this.detail = detail;
  }
}

export interface SafeFetchOptions {
  policy?: SsrfPolicy;
  timeoutMs?: number;
  maxRedirects?: number;
  maxBodyBytes?: number;
  userAgent?: string;
  method?: 'GET' | 'HEAD';
  headers?: Record<string, string>;
}

export interface RedirectHop {
  url: string;
  status: number;
  location: string;
}

export interface SafeFetchResult {
  requestedUrl: string;
  finalUrl: string;
  status: number;
  headers: Record<string, string>;
  redirects: RedirectHop[];
  /** Decoded body, capped at maxBodyBytes. Empty for HEAD requests. */
  body: string;
  /**
   * The same bytes before UTF-8 decoding. Needed by callers that handle
   * compressed payloads (gzipped sitemaps), where decoding to a string first
   * would destroy the data irrecoverably.
   */
  bodyBuffer: Buffer;
  bodyBytes: number;
  truncated: boolean;
  contentType: string | null;
  contentLength: number | null;
  durationMs: number;
  /** The IP the final hop was pinned to, for audit logging. */
  peerAddress: string | null;
}

const DEFAULTS = {
  timeoutMs: 10_000,
  maxRedirects: 5,
  maxBodyBytes: 512 * 1024,
  userAgent: 'IndexPilotBot/1.0',
};

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * Performs an HTTP(S) request against a user supplied URL with the full SSRF
 * policy applied to *every* hop.
 *
 * Guarantees:
 *  - only http/https,
 *  - DNS is resolved before connecting and the socket is pinned to a validated
 *    address (closes the DNS-rebinding window between check and connect),
 *  - each redirect target is revalidated from scratch before it is followed,
 *  - the response body is streamed and hard-capped,
 *  - connection, headers and body all have timeouts.
 */
export async function safeFetch(
  rawUrl: string,
  options: SafeFetchOptions = {},
): Promise<SafeFetchResult> {
  const policy = options.policy ?? DEFAULT_SSRF_POLICY;
  const timeoutMs = options.timeoutMs ?? DEFAULTS.timeoutMs;
  const maxRedirects = options.maxRedirects ?? DEFAULTS.maxRedirects;
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULTS.maxBodyBytes;
  const userAgent = options.userAgent ?? DEFAULTS.userAgent;
  const method = options.method ?? 'GET';

  const startedAt = Date.now();
  const redirects: RedirectHop[] = [];
  let current: URL;
  try {
    current = new URL(rawUrl);
  } catch {
    throw new SafeFetchError('SSRF_BLOCKED', 'URL could not be parsed.');
  }

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const assessment = await assertOrThrow(current, policy);
    const pinned = assessment.addresses[0];
    if (!pinned) {
      throw new SafeFetchError('SSRF_BLOCKED', 'No validated address available for host.');
    }

    const agent = new Agent({
      connections: 1,
      pipelining: 0,
      headersTimeout: timeoutMs,
      bodyTimeout: timeoutMs,
      connectTimeout: Math.min(timeoutMs, 5_000),
      connect: {
        timeout: Math.min(timeoutMs, 5_000),
        // Pin the socket to the address we validated a moment ago. The hostname
        // is still used for SNI and certificate verification.
        lookup: (_hostname, _opts, callback) => {
          callback(null, [{ address: pinned.address, family: pinned.family }]);
        },
      },
    });

    try {
      const response = await undiciRequest(current.toString(), {
        method,
        dispatcher: agent,
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          'user-agent': userAgent,
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'accept-encoding': 'identity',
          ...options.headers,
        },
      });

      const headers = flattenHeaders(response.headers);

      if (REDIRECT_STATUSES.has(response.statusCode)) {
        const location = headers['location'];
        discardBody(response.body);
        if (!location) {
          throw new SafeFetchError(
            'INVALID_REDIRECT',
            `HTTP ${response.statusCode} without a Location header.`,
          );
        }
        let next: URL;
        try {
          next = new URL(location, current);
        } catch {
          throw new SafeFetchError('INVALID_REDIRECT', `Unparseable redirect target "${location}".`);
        }
        redirects.push({ url: current.toString(), status: response.statusCode, location: next.toString() });
        if (hop === maxRedirects) {
          throw new SafeFetchError(
            'TOO_MANY_REDIRECTS',
            `Exceeded ${maxRedirects} redirects starting at ${rawUrl}.`,
          );
        }
        current = next;
        continue;
      }

      const { text, buffer, bytes, truncated } =
        method === 'HEAD'
          ? { text: '', buffer: Buffer.alloc(0), bytes: 0, truncated: false }
          : await readCapped(response.body, maxBodyBytes);

      return {
        requestedUrl: rawUrl,
        finalUrl: current.toString(),
        status: response.statusCode,
        headers,
        redirects,
        body: text,
        bodyBuffer: buffer,
        bodyBytes: bytes,
        truncated,
        contentType: headers['content-type'] ?? null,
        contentLength: headers['content-length'] ? Number(headers['content-length']) : null,
        durationMs: Date.now() - startedAt,
        peerAddress: pinned.address,
      };
    } catch (error) {
      if (error instanceof SafeFetchError) throw error;
      throw toFetchError(error);
    } finally {
      void agent.close().catch(() => undefined);
    }
  }

  throw new SafeFetchError('TOO_MANY_REDIRECTS', `Exceeded ${maxRedirects} redirects.`);
}

async function assertOrThrow(url: URL, policy: SsrfPolicy) {
  try {
    return await assertUrlIsFetchable(url, policy);
  } catch (error) {
    if (error instanceof SsrfError) {
      throw new SafeFetchError('SSRF_BLOCKED', error.message, error.reason);
    }
    throw error;
  }
}

function toFetchError(error: unknown): SafeFetchError {
  const err = error as { name?: string; code?: string; message?: string };
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError' || err?.code === 'UND_ERR_HEADERS_TIMEOUT') {
    return new SafeFetchError('TIMEOUT', 'The request timed out.', err.code);
  }
  if (err?.code === 'UND_ERR_BODY_TIMEOUT') {
    return new SafeFetchError('TIMEOUT', 'The response body timed out.', err.code);
  }
  return new SafeFetchError(
    'NETWORK_ERROR',
    err?.message ? `Request failed: ${err.message}` : 'Request failed.',
    err?.code,
  );
}

function flattenHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    out[key.toLowerCase()] = Array.isArray(value) ? (value[0] ?? '') : value;
  }
  return out;
}

type DestroyableBody = AsyncIterable<Buffer> & {
  destroy?: (error?: Error) => void;
  on?: (event: 'error', listener: (error: Error) => void) => unknown;
};

/**
 * Abandons a response body we deliberately stopped reading. Destroying an
 * undici body emits UND_ERR_ABORTED; without a listener that becomes an
 * unhandled error in the worker process.
 */
function discardBody(stream: DestroyableBody): void {
  stream.on?.('error', () => undefined);
  stream.destroy?.();
}

/** Reads at most `limit` bytes then tears the stream down. */
async function readCapped(
  stream: DestroyableBody,
  limit: number,
): Promise<{ text: string; buffer: Buffer; bytes: number; truncated: boolean }> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  let truncated = false;
  for await (const chunk of stream) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    if (bytes + buf.length > limit) {
      chunks.push(buf.subarray(0, Math.max(0, limit - bytes)));
      bytes = limit;
      truncated = true;
      discardBody(stream);
      break;
    }
    chunks.push(buf);
    bytes += buf.length;
  }
  const buffer = Buffer.concat(chunks);
  return { text: buffer.toString('utf8'), buffer, bytes, truncated };
}
