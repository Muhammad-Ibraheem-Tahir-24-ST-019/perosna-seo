import { createHash } from 'node:crypto';

export interface NormalizedUrl {
  /** Exactly what the user submitted (trimmed only). */
  originalUrl: string;
  normalizedUrl: string;
  normalizedUrlHash: string;
  scheme: 'http' | 'https';
  hostname: string;
  port: number | null;
  path: string;
  query: string;
}

export interface NormalizeFailure {
  originalUrl: string;
  reason: NormalizeErrorReason;
  message: string;
}

export type NormalizeErrorReason =
  | 'EMPTY'
  | 'TOO_LONG'
  | 'UNPARSEABLE'
  | 'UNSUPPORTED_SCHEME'
  | 'MISSING_HOST'
  | 'CREDENTIALS_IN_URL'
  | 'INVALID_HOST';

export const MAX_URL_LENGTH = 2048;

const SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
const ALLOWED_SCHEMES = new Set(['http:', 'https:']);

/**
 * Conservative normalization: it lowercases the scheme/host, drops the fragment
 * and a default port, and nothing else. Query parameters are preserved verbatim
 * (including order) because stripping them can change the page that is served.
 */
export function normalizeUrl(input: string): NormalizedUrl | NormalizeFailure {
  const originalUrl = stripWrappers(input);

  if (!originalUrl) {
    return { originalUrl: input, reason: 'EMPTY', message: 'Empty line.' };
  }
  if (originalUrl.length > MAX_URL_LENGTH) {
    return {
      originalUrl,
      reason: 'TOO_LONG',
      message: `URL exceeds ${MAX_URL_LENGTH} characters.`,
    };
  }
  // A scheme-less "example.com/page" is a very common paste; assume https.
  const withScheme = SCHEME_RE.test(originalUrl) ? originalUrl : `https://${originalUrl}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return { originalUrl, reason: 'UNPARSEABLE', message: 'URL could not be parsed.' };
  }

  // Scheme is checked before character hygiene so that data:/javascript: inputs
  // get the accurate "unsupported protocol" reason rather than a generic one.
  if (!ALLOWED_SCHEMES.has(url.protocol)) {
    return {
      originalUrl,
      reason: 'UNSUPPORTED_SCHEME',
      message: `Unsupported protocol "${url.protocol.replace(':', '')}". Only http and https are accepted.`,
    };
  }
  if (/[\s<>"{}|\\^`]/.test(originalUrl)) {
    return { originalUrl, reason: 'UNPARSEABLE', message: 'URL contains illegal characters.' };
  }
  if (url.username || url.password) {
    return {
      originalUrl,
      reason: 'CREDENTIALS_IN_URL',
      message: 'URLs containing credentials are rejected.',
    };
  }

  // URL keeps a trailing dot ("example.com.") which resolves the same but breaks dedup.
  const hostname = url.hostname.replace(/\.$/, '').toLowerCase();
  if (!hostname) {
    return { originalUrl, reason: 'MISSING_HOST', message: 'URL has no hostname.' };
  }
  if (!isPlausibleHost(hostname)) {
    return { originalUrl, reason: 'INVALID_HOST', message: `Invalid hostname "${hostname}".` };
  }

  url.hostname = hostname;
  url.hash = '';
  if (url.search === '?') url.search = '';
  if (
    (url.protocol === 'http:' && url.port === '80') ||
    (url.protocol === 'https:' && url.port === '443')
  ) {
    url.port = '';
  }
  if (url.pathname === '') url.pathname = '/';

  const normalizedUrl = url.toString();
  const scheme = url.protocol === 'https:' ? 'https' : 'http';

  return {
    originalUrl,
    normalizedUrl,
    normalizedUrlHash: hashNormalizedUrl(normalizedUrl),
    scheme,
    hostname,
    port: url.port ? Number(url.port) : null,
    path: url.pathname,
    query: url.search,
  };
}

export function isNormalizeFailure(
  value: NormalizedUrl | NormalizeFailure,
): value is NormalizeFailure {
  return 'reason' in value;
}

export function hashNormalizedUrl(normalizedUrl: string): string {
  return createHash('sha256').update(normalizedUrl, 'utf8').digest('hex');
}

function stripWrappers(value: string): string {
  let out = value.trim();
  // Strip a UTF-8 BOM that survives .txt uploads, and common paste wrappers.
  if (out.charCodeAt(0) === 0xfeff) out = out.slice(1).trim();
  // CSV/list pastes leave a trailing separator outside the wrapper: "<url>,".
  out = out.replace(/[,;]+$/, '').trim();
  while (out.length > 1) {
    const first = out[0] as string;
    const last = out[out.length - 1] as string;
    if ((first === '<' && last === '>') || (first === '"' && last === '"')) {
      out = out.slice(1, -1).trim();
      continue;
    }
    if (first === "'" && last === "'") {
      out = out.slice(1, -1).trim();
      continue;
    }
    break;
  }
  return out.replace(/[,;]+$/, '').trim();
}

function isPlausibleHost(hostname: string): boolean {
  if (hostname.length > 253) return false;
  // Bracketed IPv6 literals are handed to us already unwrapped by URL.
  if (hostname.startsWith('[') || hostname.includes(':')) return true;
  if (/^[0-9.]+$/.test(hostname)) return true;
  if (/^[a-z0-9]$/.test(hostname)) return true;
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/.test(hostname);
}
