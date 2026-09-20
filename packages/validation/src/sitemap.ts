/**
 * Engine 2 — sitemap discovery, parsing and validation.
 *
 * Kept regex-based like the rest of this package: sitemaps in the wild are
 * frequently malformed (unescaped ampersands, wrong namespace, HTML error pages
 * served with an XML content type), and the tool's job is to *report* that
 * rather than throw. A strict XML parser would fail on exactly the files a
 * validator exists to diagnose.
 */

import { gunzipSync, inflateSync } from 'node:zlib';
import { safeFetch, SafeFetchError, type SafeFetchOptions } from './fetcher.js';
import { parseRobotsTxt } from './robots.js';

export const SITEMAP_NAMESPACE = 'http://www.sitemaps.org/schemas/sitemap/0.9';

/** Paths tried, in order, when the user gives a bare domain and robots.txt names no sitemap. */
export const COMMON_SITEMAP_PATHS = [
  '/sitemap.xml',
  '/sitemap_index.xml',
  '/sitemap-index.xml',
  '/sitemap.xml.gz',
  '/sitemap1.xml',
  '/wp-sitemap.xml',
  '/sitemap/sitemap.xml',
] as const;

export type SitemapKind = 'urlset' | 'sitemapindex' | 'unknown';

export interface SitemapEntry {
  loc: string;
  lastmod: string | null;
  changefreq: string | null;
  priority: string | null;
}

export interface SitemapIssue {
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  excerpt: string | null;
}

export interface ParsedSitemap {
  kind: SitemapKind;
  /** `<url>` entries for a urlset, `<sitemap>` entries for an index. */
  entries: SitemapEntry[];
  namespace: string | null;
  issues: SitemapIssue[];
  /** Raw byte size of the document as fetched. */
  bytes: number;
}

const LOC_RE = /<loc\b[^>]*>([\s\S]*?)<\/loc>/gi;
const URL_BLOCK_RE = /<url\b[^>]*>([\s\S]*?)<\/url>/gi;
const SITEMAP_BLOCK_RE = /<sitemap\b[^>]*>([\s\S]*?)<\/sitemap>/gi;
const ROOT_RE = /<(urlset|sitemapindex)\b([^>]*)>/i;

function childText(block: string, tag: string): string | null {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  const match = re.exec(block);
  if (!match) return null;
  const value = decodeXml((match[1] ?? '').trim());
  return value === '' ? null : value;
}

export function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    // &amp; last, so "&amp;lt;" does not become "<".
    .replace(/&amp;/g, '&')
    .trim();
}

/** W3C datetime as the sitemap protocol requires it. */
const LASTMOD_RE =
  /^\d{4}(-\d{2}(-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?)?)?$/;

export function parseSitemapXml(raw: string, bytes: number): ParsedSitemap {
  const issues: SitemapIssue[] = [];
  const text = raw.replace(/^\uFEFF/, '');

  if (text.trim() === '') {
    return {
      kind: 'unknown',
      entries: [],
      namespace: null,
      bytes,
      issues: [
        {
          severity: 'error',
          code: 'sitemap-empty',
          message: 'The file is empty.',
          excerpt: null,
        },
      ],
    };
  }

  if (/^\s*<!doctype html|<html\b/i.test(text.slice(0, 500))) {
    return {
      kind: 'unknown',
      entries: [],
      namespace: null,
      bytes,
      issues: [
        {
          severity: 'error',
          code: 'sitemap-is-html',
          message:
            'This is an HTML page, not XML. The URL most likely does not exist and the server is returning a page instead of a 404.',
          excerpt: text.slice(0, 160).replace(/\s+/g, ' '),
        },
      ],
    };
  }

  const root = ROOT_RE.exec(text);
  if (!root) {
    return {
      kind: 'unknown',
      entries: [],
      namespace: null,
      bytes,
      issues: [
        {
          severity: 'error',
          code: 'sitemap-no-root',
          message:
            'No <urlset> or <sitemapindex> root element. This is not a sitemap, whatever else it may be.',
          excerpt: text.slice(0, 160).replace(/\s+/g, ' '),
        },
      ],
    };
  }

  const kind: SitemapKind = (root[1] ?? '').toLowerCase() === 'sitemapindex' ? 'sitemapindex' : 'urlset';
  const nsMatch = /xmlns\s*=\s*["']([^"']+)["']/i.exec(root[2] ?? '');
  const namespace = nsMatch?.[1] ?? null;

  if (!text.trimStart().startsWith('<?xml')) {
    issues.push({
      severity: 'warning',
      code: 'sitemap-no-declaration',
      message: 'Missing the <?xml version="1.0" encoding="UTF-8"?> declaration. Most parsers cope, but it is required by the spec.',
      excerpt: null,
    });
  }
  if (namespace === null) {
    issues.push({
      severity: 'error',
      code: 'sitemap-no-namespace',
      message: `The <${kind}> element has no xmlns attribute. It must be xmlns="${SITEMAP_NAMESPACE}".`,
      excerpt: root[0].slice(0, 160),
    });
  } else if (namespace !== SITEMAP_NAMESPACE) {
    issues.push({
      severity: 'error',
      code: 'sitemap-wrong-namespace',
      message: `The namespace is "${namespace}" but must be "${SITEMAP_NAMESPACE}". Search engines reject sitemaps with the wrong namespace.`,
      excerpt: root[0].slice(0, 160),
    });
  }

  // Unescaped ampersands are the single most common sitemap syntax error.
  const badAmp = /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.exec(text);
  if (badAmp) {
    issues.push({
      severity: 'error',
      code: 'sitemap-unescaped-ampersand',
      message:
        'The file contains a raw "&" that is not part of an XML entity. This makes the document invalid XML — write it as "&amp;".',
      excerpt: text.slice(Math.max(0, badAmp.index - 40), badAmp.index + 60).replace(/\s+/g, ' '),
    });
  }

  const blockRe = kind === 'sitemapindex' ? SITEMAP_BLOCK_RE : URL_BLOCK_RE;
  blockRe.lastIndex = 0;
  const entries: SitemapEntry[] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  let block: RegExpExecArray | null;

  while ((block = blockRe.exec(text)) !== null) {
    const body = block[1] ?? '';
    const loc = childText(body, 'loc');
    if (loc === null) {
      issues.push({
        severity: 'error',
        code: 'sitemap-entry-no-loc',
        message: `An <${kind === 'sitemapindex' ? 'sitemap' : 'url'}> entry has no <loc>. Every entry must have exactly one.`,
        excerpt: body.slice(0, 160).replace(/\s+/g, ' '),
      });
      continue;
    }

    const lastmod = childText(body, 'lastmod');
    if (lastmod !== null && !LASTMOD_RE.test(lastmod)) {
      issues.push({
        severity: 'warning',
        code: 'sitemap-bad-lastmod',
        message: `"${lastmod}" is not a valid W3C date. Use YYYY-MM-DD or a full ISO 8601 timestamp — invalid dates are ignored entirely.`,
        excerpt: loc,
      });
    }

    const priority = childText(body, 'priority');
    if (priority !== null) {
      const value = Number(priority);
      if (Number.isNaN(value) || value < 0 || value > 1) {
        issues.push({
          severity: 'warning',
          code: 'sitemap-bad-priority',
          message: `<priority> must be between 0.0 and 1.0; this entry has "${priority}".`,
          excerpt: loc,
        });
      }
    }

    if (seen.has(loc)) duplicates += 1;
    seen.add(loc);

    entries.push({
      loc,
      lastmod,
      changefreq: childText(body, 'changefreq'),
      priority,
    });
  }

  // A <loc> outside any <url>/<sitemap> wrapper parses as nothing.
  LOC_RE.lastIndex = 0;
  const totalLocs = (text.match(LOC_RE) ?? []).length;
  if (totalLocs > entries.length) {
    issues.push({
      severity: 'error',
      code: 'sitemap-orphan-loc',
      message: `${totalLocs - entries.length} <loc> element(s) are not inside a <${kind === 'sitemapindex' ? 'sitemap' : 'url'}> element and will be ignored.`,
      excerpt: null,
    });
  }

  if (duplicates > 0) {
    issues.push({
      severity: 'warning',
      code: 'sitemap-duplicates',
      message: `${duplicates} duplicate URL(s). Duplicates waste crawl budget and suggest the sitemap is generated from an unfiltered query.`,
      excerpt: null,
    });
  }

  if (entries.length === 0) {
    issues.push({
      severity: 'error',
      code: 'sitemap-no-entries',
      message: 'The sitemap parsed correctly but contains no URLs.',
      excerpt: null,
    });
  }

  // Protocol limits: 50,000 URLs and 50MB uncompressed.
  if (entries.length > 50_000) {
    issues.push({
      severity: 'error',
      code: 'sitemap-too-many-urls',
      message: `${entries.length.toLocaleString('en-US')} URLs exceeds the 50,000 limit. Split it into several sitemaps behind a sitemap index.`,
      excerpt: null,
    });
  }
  if (bytes > 50 * 1024 * 1024) {
    issues.push({
      severity: 'error',
      code: 'sitemap-too-large',
      message: 'The file is over the 50MB uncompressed limit and will be rejected.',
      excerpt: null,
    });
  }

  return { kind, entries, namespace, issues, bytes };
}

// --- Fetching -------------------------------------------------------------

export interface SitemapFetchResult {
  url: string;
  finalUrl: string;
  status: number;
  contentType: string | null;
  parsed: ParsedSitemap | null;
  /** Set when the document could not be retrieved at all. */
  error: { code: string; message: string } | null;
}

/**
 * Sitemaps are commonly gzipped. The fetcher asks for `identity` encoding, so a
 * `.xml.gz` arrives as compressed bytes and must be unwrapped here. We work from
 * the raw buffer rather than the decoded string because UTF-8 decoding gzip
 * bytes is lossy and cannot be reversed.
 */
function maybeDecompress(buffer: Buffer, text: string, url: string, contentType: string | null): string {
  const isGzipMagic = buffer.length > 2 && buffer[0] === 0x1f && buffer[1] === 0x8b;
  const declared =
    url.toLowerCase().endsWith('.gz') || (contentType ?? '').toLowerCase().includes('gzip');
  if (!isGzipMagic && !declared) return text;

  try {
    return gunzipSync(buffer).toString('utf8');
  } catch {
    try {
      return inflateSync(buffer).toString('utf8');
    } catch {
      // Declared as gzip but is not: fall back to the plain text, which the
      // parser will then report on honestly.
      return text;
    }
  }
}

export async function fetchSitemap(
  url: string,
  options: SafeFetchOptions = {},
): Promise<SitemapFetchResult> {
  try {
    const response = await safeFetch(url, {
      // Sitemaps are much larger than the HTML pages this fetcher normally sees.
      maxBodyBytes: 8 * 1024 * 1024,
      ...options,
      method: 'GET',
    });

    if (response.status >= 400) {
      return {
        url,
        finalUrl: response.finalUrl,
        status: response.status,
        contentType: response.contentType,
        parsed: null,
        error: {
          code: 'http-error',
          message: `The server returned HTTP ${response.status}.`,
        },
      };
    }

    const body = maybeDecompress(
      response.bodyBuffer,
      response.body,
      response.finalUrl,
      response.contentType,
    );
    const parsed = parseSitemapXml(body, response.bodyBytes);

    if (response.truncated) {
      parsed.issues.push({
        severity: 'warning',
        code: 'sitemap-truncated',
        message:
          'The sitemap was larger than this tool reads in one pass, so the checks below cover the first part of the file only.',
        excerpt: null,
      });
    }

    const type = (response.contentType ?? '').toLowerCase();
    if (type && !type.includes('xml') && !type.includes('gzip') && !type.includes('octet-stream')) {
      parsed.issues.push({
        severity: 'warning',
        code: 'sitemap-content-type',
        message: `Served as "${response.contentType}". It should be "application/xml" or "text/xml" — some crawlers skip sitemaps served as something else.`,
        excerpt: null,
      });
    }

    return {
      url,
      finalUrl: response.finalUrl,
      status: response.status,
      contentType: response.contentType,
      parsed,
      error: null,
    };
  } catch (error) {
    const message = error instanceof SafeFetchError ? error.message : 'The sitemap could not be fetched.';
    const code = error instanceof SafeFetchError ? error.code : 'NETWORK_ERROR';
    return {
      url,
      finalUrl: url,
      status: 0,
      contentType: null,
      parsed: null,
      error: { code, message },
    };
  }
}

export interface SitemapDiscovery {
  /** Where each candidate came from, so the UI can explain how it was found. */
  source: 'provided' | 'robots' | 'common-path';
  url: string;
}

/**
 * Works out which sitemap URL(s) to check for a user-supplied domain or URL.
 *
 * Order matters: an explicit URL is used as given, otherwise robots.txt is
 * authoritative, and only then do we guess at conventional paths.
 */
export async function discoverSitemaps(
  input: URL,
  options: SafeFetchOptions = {},
): Promise<{ candidates: SitemapDiscovery[]; robotsSitemaps: string[]; robotsError: string | null }> {
  const looksLikeSitemapUrl =
    /\.xml(\.gz)?$/i.test(input.pathname) || /sitemap/i.test(input.pathname);
  if (looksLikeSitemapUrl && input.pathname !== '/') {
    return { candidates: [{ source: 'provided', url: input.toString() }], robotsSitemaps: [], robotsError: null };
  }

  let robotsSitemaps: string[] = [];
  let robotsError: string | null = null;
  try {
    const robots = await safeFetch(new URL('/robots.txt', input.origin).toString(), {
      ...options,
      method: 'GET',
    });
    if (robots.status < 400) {
      robotsSitemaps = parseRobotsTxt(robots.body).sitemaps;
    } else {
      robotsError = `robots.txt returned HTTP ${robots.status}.`;
    }
  } catch (error) {
    robotsError = error instanceof SafeFetchError ? error.message : 'robots.txt could not be fetched.';
  }

  const candidates: SitemapDiscovery[] = [];
  const seen = new Set<string>();
  for (const sitemap of robotsSitemaps) {
    try {
      const absolute = new URL(sitemap, input.origin).toString();
      if (seen.has(absolute)) continue;
      seen.add(absolute);
      candidates.push({ source: 'robots', url: absolute });
    } catch {
      // A malformed Sitemap: line is reported by the robots auditor, not here.
    }
  }

  if (candidates.length === 0) {
    for (const path of COMMON_SITEMAP_PATHS) {
      const absolute = new URL(path, input.origin).toString();
      if (seen.has(absolute)) continue;
      seen.add(absolute);
      candidates.push({ source: 'common-path', url: absolute });
    }
  }

  return { candidates, robotsSitemaps, robotsError };
}
