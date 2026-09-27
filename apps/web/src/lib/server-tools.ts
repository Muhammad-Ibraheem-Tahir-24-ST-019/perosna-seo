import {
  DEFAULT_SSRF_POLICY,
  SafeFetchError,
  analysePageMeta,
  auditRobotsTxt,
  discoverSitemaps,
  fetchSitemap,
  formatRule,
  isNormalizeFailure,
  normalizeUrl,
  parseRobotsTxt,
  resolveRobotsRule,
  safeFetch,
  type SafeFetchOptions,
  type SitemapEntry,
  type SsrfPolicy,
} from '@indexpilot/validation';
import type {
  MetaToolResult,
  RobotsPathVerdict,
  RobotsToolResult,
  SitemapToolResult,
  SitemapUrlCheck,
  ToolQuota,
  ToolRunMeta,
} from '@indexpilot/shared/client';

/**
 * Server-side SEO Micro-Tools engine for Next.js.
 *
 * Implements the build brief specifications:
 * - Engine 1: Single-page fetch & parse (Robots.txt, Page Meta, Canonical)
 * - Engine 2: Sitemap fetch & validate (XML parsing, namespace, URL status crawling)
 * - Safe SSRF policies & private network protection
 * - 15-minute in-memory cache per URL (polite to target servers, lightning fast)
 * - Abuse prevention & rate limiting per IP (100 runs / hour)
 * - Free to use, no account or login required
 */

// ---------------------------------------------------------------------------
// Rate Limiter & In-Memory Cache
// ---------------------------------------------------------------------------

interface CacheEntry<T> {
  value: T;
  cachedAt: number;
}

const memoryCache = new Map<string, CacheEntry<unknown>>();
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

interface QuotaTracker {
  count: number;
  resetAt: number;
}

const ipQuotas = new Map<string, QuotaTracker>();
const HOURLY_LIMIT = 120; // 120 checks/hr for free users
const ONE_HOUR_MS = 60 * 60 * 1000;

export function consumeToolQuota(ip: string): { allowed: boolean; quota: ToolQuota } {
  const now = Date.now();
  const tracker = ipQuotas.get(ip);

  if (!tracker || tracker.resetAt <= now) {
    ipQuotas.set(ip, { count: 1, resetAt: now + ONE_HOUR_MS });
    return {
      allowed: true,
      quota: {
        remaining: HOURLY_LIMIT - 1,
        limit: HOURLY_LIMIT,
        resetSeconds: Math.round(ONE_HOUR_MS / 1000),
      },
    };
  }

  if (tracker.count >= HOURLY_LIMIT) {
    const resetSeconds = Math.max(1, Math.round((tracker.resetAt - now) / 1000));
    return {
      allowed: false,
      quota: {
        remaining: 0,
        limit: HOURLY_LIMIT,
        resetSeconds,
      },
    };
  }

  tracker.count += 1;
  const resetSeconds = Math.max(1, Math.round((tracker.resetAt - now) / 1000));
  return {
    allowed: true,
    quota: {
      remaining: HOURLY_LIMIT - tracker.count,
      limit: HOURLY_LIMIT,
      resetSeconds,
    },
  };
}

function getFromCache<T>(key: string): { value: T; ageSeconds: number } | null {
  const entry = memoryCache.get(key) as CacheEntry<T> | undefined;
  if (!entry) return null;
  const now = Date.now();
  if (now - entry.cachedAt > CACHE_TTL_MS) {
    memoryCache.delete(key);
    return null;
  }
  return {
    value: entry.value,
    ageSeconds: Math.round((now - entry.cachedAt) / 1000),
  };
}

function setToCache<T>(key: string, value: T): void {
  // Bound cache size to prevent memory bloat
  if (memoryCache.size > 2000) {
    const firstKey = memoryCache.keys().next().value;
    if (firstKey) memoryCache.delete(firstKey);
  }
  memoryCache.set(key, { value, cachedAt: Date.now() });
}

// ---------------------------------------------------------------------------
// Shared Fetch Config
// ---------------------------------------------------------------------------

function ssrfPolicy(): SsrfPolicy {
  return {
    ...DEFAULT_SSRF_POLICY,
    allowPrivateNetwork: process.env.ALLOW_PRIVATE_NETWORK_FETCH === 'true',
  };
}

function fetchOptions(overrides: SafeFetchOptions = {}): SafeFetchOptions {
  return {
    policy: ssrfPolicy(),
    timeoutMs: 10_000,
    maxRedirects: 5,
    userAgent:
      process.env.FETCH_USER_AGENT ??
      'Mozilla/5.0 (compatible; SEOMicroTools/1.0; +https://seomicrotools.com/bot)',
    ...overrides,
  };
}

export function resolveTarget(input: string): URL {
  const trimmed = input.trim();
  if (!trimmed) throw new Error('Enter a URL or domain to check.');

  const normalized = normalizeUrl(trimmed);
  if (isNormalizeFailure(normalized)) {
    throw new Error(normalized.message);
  }
  return new URL(normalized.normalizedUrl);
}

// ---------------------------------------------------------------------------
// Tool 1: Robots.txt Tester
// ---------------------------------------------------------------------------

const MAX_ROBOTS_TESTS = 25;

export async function runRobotsToolStandalone(
  rawInput: string,
  options: { paths?: string[]; userAgent?: string } = {},
): Promise<{ result: RobotsToolResult; meta: ToolRunMeta }> {
  const startedAt = Date.now();
  const target = resolveTarget(rawInput);
  const robotsUrl = new URL('/robots.txt', target.origin).toString();
  const testAgent = (options.userAgent ?? 'Googlebot').slice(0, 120);

  const cacheKey = `robots:${robotsUrl}`;
  const cached = getFromCache<Omit<RobotsToolResult, 'tests' | 'input'>>(cacheKey);

  let base: Omit<RobotsToolResult, 'tests' | 'input'>;
  let cacheAgeSeconds = 0;

  if (cached) {
    base = cached.value;
    cacheAgeSeconds = cached.ageSeconds;
  } else {
    base = await fetchRobots(robotsUrl);
    setToCache(cacheKey, base);
  }

  const requested = (options.paths ?? []).map((path) => path.trim()).filter(Boolean);
  const paths = [...new Set([target.pathname + target.search, ...requested])].slice(
    0,
    MAX_ROBOTS_TESTS,
  );

  const parsed = base.content === null ? { groups: [], sitemaps: [] } : parseRobotsTxt(base.content);
  const tests: RobotsPathVerdict[] = paths.map((path) => {
    const normalisedPath = path.startsWith('/') ? path : `/${path}`;
    if (!base.exists) {
      return {
        path: normalisedPath,
        userAgent: testAgent,
        allowed: true,
        matchedRule: null,
        explanation:
          'There is no robots.txt on this domain, and search engines treat a missing file as "crawl everything".',
      };
    }
    const verdict = resolveRobotsRule(parsed, normalisedPath, testAgent);
    return {
      path: normalisedPath,
      userAgent: testAgent,
      allowed: verdict.allowed,
      matchedRule: verdict.rule ? formatRule(verdict.rule) : null,
      explanation: explainRobotsVerdict(verdict, testAgent, normalisedPath),
    };
  });

  return {
    result: { ...base, input: rawInput.trim(), tests },
    meta: {
      cached: cached !== null,
      cacheAgeSeconds,
      durationMs: Date.now() - startedAt,
      checkedAt: new Date().toISOString(),
    },
  };
}

function explainRobotsVerdict(
  verdict: ReturnType<typeof resolveRobotsRule>,
  userAgent: string,
  path: string,
): string {
  if (!verdict.rule) {
    return `No rule in this file matches ${path}, so ${userAgent} is allowed to crawl it. Anything not disallowed is allowed.`;
  }
  const group = verdict.group?.agents.join(', ') ?? '*';
  const rule = formatRule(verdict.rule);
  if (verdict.allowed) {
    return `Allowed by "${rule}" in the "User-agent: ${group}" group. That rule is the longest match for this path, and Allow beats Disallow at equal length.`;
  }
  return `Blocked by "${rule}" in the "User-agent: ${group}" group. ${userAgent} will not crawl ${path} while that rule is live.`;
}

async function fetchRobots(robotsUrl: string): Promise<Omit<RobotsToolResult, 'tests' | 'input'>> {
  const empty = {
    robotsUrl,
    finalUrl: robotsUrl,
    status: 0,
    exists: false,
    content: null,
    contentType: null,
    sitemaps: [] as string[],
    groups: [] as { agents: string[]; rules: { type: string; path: string }[] }[],
  };

  try {
    const response = await safeFetch(robotsUrl, fetchOptions({ method: 'GET' }));

    if (response.status === 404 || response.status === 410) {
      return {
        ...empty,
        finalUrl: response.finalUrl,
        status: response.status,
        audit: auditRobotsTxt('', { groups: [], sitemaps: [] }),
        error: null,
      };
    }
    if (response.status >= 400) {
      return {
        ...empty,
        finalUrl: response.finalUrl,
        status: response.status,
        audit: auditRobotsTxt('', { groups: [], sitemaps: [] }),
        error: {
          code: 'http-error',
          message: `The server returned HTTP ${response.status} when looking for /robots.txt.`,
        },
      };
    }

    const isText = (response.contentType ?? '').toLowerCase().includes('text/');
    const isHtml = (response.contentType ?? '').toLowerCase().includes('html');
    const parsed = parseRobotsTxt(response.body);
    const audit = auditRobotsTxt(response.body, parsed);

    return {
      robotsUrl,
      finalUrl: response.finalUrl,
      status: response.status,
      exists: true,
      content: response.body,
      contentType: response.contentType,
      audit,
      sitemaps: parsed.sitemaps,
      groups: parsed.groups.map((group) => ({
        agents: group.agents,
        rules: group.rules.map((rule) => ({ type: rule.type, path: rule.path })),
      })),
      error:
        !isText && !isHtml
          ? {
              code: 'unexpected-content-type',
              message: `The server sent content-type "${response.contentType ?? 'none'}" instead of text/plain. Crawlers may refuse to parse it.`,
            }
          : null,
    };
  } catch (error) {
    const message =
      error instanceof SafeFetchError ? error.message : 'The robots.txt file could not be fetched.';
    const code = error instanceof SafeFetchError ? error.code : 'NETWORK_ERROR';
    return {
      ...empty,
      audit: auditRobotsTxt('', { groups: [], sitemaps: [] }),
      error: { code, message },
    };
  }
}

// ---------------------------------------------------------------------------
// Tool 2 & 3: Meta Title, Description & Canonical Tag Checker
// ---------------------------------------------------------------------------

export async function runMetaToolStandalone(
  rawInput: string,
): Promise<{ result: MetaToolResult; meta: ToolRunMeta }> {
  const startedAt = Date.now();
  const target = resolveTarget(rawInput);
  const cacheKey = `meta:${target.toString()}`;

  const cached = getFromCache<Omit<MetaToolResult, 'input'>>(cacheKey);
  let base: Omit<MetaToolResult, 'input'>;
  let cacheAgeSeconds = 0;

  if (cached) {
    base = cached.value;
    cacheAgeSeconds = cached.ageSeconds;
  } else {
    base = await fetchPageMeta(target);
    setToCache(cacheKey, base);
  }

  return {
    result: { ...base, input: rawInput.trim() },
    meta: {
      cached: cached !== null,
      cacheAgeSeconds,
      durationMs: Date.now() - startedAt,
      checkedAt: new Date().toISOString(),
    },
  };
}

async function fetchPageMeta(target: URL): Promise<Omit<MetaToolResult, 'input'>> {
  const requestedUrl = target.toString();
  try {
    const response = await safeFetch(requestedUrl, fetchOptions({ method: 'GET' }));

    if (response.status >= 400) {
      return {
        requestedUrl,
        finalUrl: response.finalUrl,
        status: response.status,
        contentType: response.contentType,
        redirectCount: response.redirects.length,
        redirectChain: response.redirects.map((hop) => hop.url),
        xRobotsTag: response.headers['x-robots-tag'] ?? null,
        report: null,
        robotsTxtAllowed: null,
        robotsTxtNote: null,
        error: {
          code: 'http-error',
          message: `The page returned HTTP ${response.status}, so there are no tags to check.`,
        },
      };
    }

    const isHtml = (response.contentType ?? '').toLowerCase().includes('html');
    return {
      requestedUrl,
      finalUrl: response.finalUrl,
      status: response.status,
      contentType: response.contentType,
      redirectCount: response.redirects.length,
      redirectChain: response.redirects.map((hop) => hop.url),
      xRobotsTag: response.headers['x-robots-tag'] ?? null,
      report: analysePageMeta(response.body, response.finalUrl),
      robotsTxtAllowed: null,
      robotsTxtNote: null,
      error: isHtml
        ? null
        : {
            code: 'not-html',
            message: `This URL is served as "${response.contentType ?? 'an unknown type'}", not HTML. The results below may be meaningless.`,
          },
    };
  } catch (error) {
    const message =
      error instanceof SafeFetchError ? error.message : 'The page could not be fetched.';
    const code = error instanceof SafeFetchError ? error.code : 'NETWORK_ERROR';
    return {
      requestedUrl,
      finalUrl: requestedUrl,
      status: 0,
      contentType: null,
      redirectCount: 0,
      redirectChain: [],
      xRobotsTag: null,
      report: null,
      robotsTxtAllowed: null,
      robotsTxtNote: null,
      error: { code, message },
    };
  }
}

// ---------------------------------------------------------------------------
// Tool 4: Sitemap Checker & Validator
// ---------------------------------------------------------------------------

const MAX_CHILD_SITEMAPS = 5;
const DEFAULT_SITEMAP_CHECK_LIMIT = 50;

export async function runSitemapToolStandalone(
  rawInput: string,
  options: { urlCheckLimit?: number; checkUrls?: boolean } = {},
): Promise<{ result: SitemapToolResult; meta: ToolRunMeta }> {
  const startedAt = Date.now();
  const target = resolveTarget(rawInput);
  const limit = options.urlCheckLimit ?? DEFAULT_SITEMAP_CHECK_LIMIT;
  const checkUrls = options.checkUrls !== false && limit > 0;
  const cacheKey = `sitemap:${target.toString()}|limit=${limit}|check=${checkUrls}`;

  const cached = getFromCache<Omit<SitemapToolResult, 'input'>>(cacheKey);
  if (cached) {
    return {
      result: { ...cached.value, input: rawInput.trim() },
      meta: {
        cached: true,
        cacheAgeSeconds: cached.ageSeconds,
        durationMs: Date.now() - startedAt,
        checkedAt: new Date().toISOString(),
      },
    };
  }

  const base = await inspectSitemap(target, limit, checkUrls);
  setToCache(cacheKey, base);

  return {
    result: { ...base, input: rawInput.trim() },
    meta: {
      cached: false,
      cacheAgeSeconds: 0,
      durationMs: Date.now() - startedAt,
      checkedAt: new Date().toISOString(),
    },
  };
}

async function inspectSitemap(
  target: URL,
  urlCheckLimit: number,
  checkUrls: boolean,
): Promise<Omit<SitemapToolResult, 'input'>> {
  const { candidates, robotsSitemaps, robotsError } = await discoverSitemaps(
    target,
    fetchOptions(),
  );

  const discovery: SitemapToolResult['discovery'] = candidates.map((candidate) => ({
    source: candidate.source,
    url: candidate.url,
    used: false,
  }));

  let found: Awaited<ReturnType<typeof fetchSitemap>> | null = null;
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    if (!candidate) continue;
    const attempt = await fetchSitemap(candidate.url, fetchOptions());
    if (attempt.parsed && attempt.parsed.kind !== 'unknown') {
      found = attempt;
      const row = discovery[index];
      if (row) row.used = true;
      break;
    }
    if (candidate.source === 'provided') {
      found = attempt;
      const row = discovery[index];
      if (row) row.used = true;
      break;
    }
  }

  const emptySummary = {
    checkedCount: 0,
    okCount: 0,
    redirectCount: 0,
    brokenCount: 0,
    blockedCount: 0,
    notCheckedCount: 0,
    limit: urlCheckLimit,
  };

  if (!found) {
    return {
      discovery,
      robotsSitemaps,
      robotsError,
      sitemapUrl: null,
      kind: 'unknown',
      totalEntries: 0,
      childSitemaps: [],
      entries: [],
      issues: [],
      checked: [],
      summary: emptySummary,
      error: {
        code: 'not-found',
        message:
          'No sitemap was found. Nothing was listed in robots.txt and none of the conventional paths returned one.',
      },
    };
  }

  if (!found.parsed) {
    return {
      discovery,
      robotsSitemaps,
      robotsError,
      sitemapUrl: found.url,
      kind: 'unknown',
      totalEntries: 0,
      childSitemaps: [],
      entries: [],
      issues: [],
      checked: [],
      summary: emptySummary,
      error: found.error,
    };
  }

  const parsed = found.parsed;
  const childSitemaps: SitemapToolResult['childSitemaps'] = [];
  let entries = parsed.entries;
  const issues = [...parsed.issues];

  if (parsed.kind === 'sitemapindex') {
    const children = parsed.entries.slice(0, MAX_CHILD_SITEMAPS);
    const collected: SitemapEntry[] = [];
    for (const child of children) {
      const childResult = await fetchSitemap(child.loc, fetchOptions());
      if (childResult.parsed && childResult.parsed.kind === 'urlset') {
        collected.push(...childResult.parsed.entries);
        childSitemaps.push({ url: child.loc, entries: childResult.parsed.entries.length, error: null });
        issues.push(...childResult.parsed.issues);
      } else {
        childSitemaps.push({
          url: child.loc,
          entries: 0,
          error: childResult.error?.message ?? 'This child sitemap could not be parsed.',
        });
      }
    }
    if (parsed.entries.length > MAX_CHILD_SITEMAPS) {
      issues.push({
        severity: 'info',
        code: 'sitemap-index-partial',
        message: `This index lists ${parsed.entries.length} sitemaps; the first ${MAX_CHILD_SITEMAPS} were opened for the URL checks below.`,
        excerpt: null,
      });
    }
    entries = collected;
  }

  const checked = checkUrls ? await checkSitemapUrls(entries, urlCheckLimit) : [];

  const summary = {
    checkedCount: checked.length,
    okCount: checked.filter((row) => row.state === 'ok').length,
    redirectCount: checked.filter((row) => row.state === 'redirect').length,
    brokenCount: checked.filter(
      (row) => row.state === 'client-error' || row.state === 'server-error' || row.state === 'unreachable',
    ).length,
    blockedCount: checked.filter((row) => row.state === 'blocked').length,
    notCheckedCount: Math.max(0, entries.length - checked.length),
    limit: urlCheckLimit,
  };

  return {
    discovery,
    robotsSitemaps,
    robotsError,
    sitemapUrl: found.finalUrl,
    kind: parsed.kind,
    totalEntries: entries.length,
    childSitemaps,
    entries: entries.slice(0, 1000),
    issues,
    checked,
    summary,
    error: null,
  };
}

async function checkSitemapUrls(
  entries: SitemapEntry[],
  limit: number,
): Promise<SitemapUrlCheck[]> {
  const slice = entries.slice(0, limit);
  if (slice.length === 0) return [];

  const robotsByOrigin = new Map<string, ReturnType<typeof parseRobotsTxt> | null>();
  async function robotsFor(origin: string) {
    if (robotsByOrigin.has(origin)) return robotsByOrigin.get(origin) ?? null;
    let parsed: ReturnType<typeof parseRobotsTxt> | null = null;
    try {
      const response = await safeFetch(
        new URL('/robots.txt', origin).toString(),
        fetchOptions({ method: 'GET' }),
      );
      if (response.status < 400) parsed = parseRobotsTxt(response.body);
    } catch {
      parsed = null;
    }
    robotsByOrigin.set(origin, parsed);
    return parsed;
  }

  const results: SitemapUrlCheck[] = new Array(slice.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= slice.length) return;
      const entry = slice[index];
      if (!entry) return;
      results[index] = await checkOne(entry.loc);
    }
  }

  async function checkOne(loc: string): Promise<SitemapUrlCheck> {
    let url: URL;
    try {
      url = new URL(loc);
    } catch {
      return {
        url: loc,
        status: null,
        state: 'unreachable',
        finalUrl: null,
        note: 'Not a valid URL.',
      };
    }

    const robots = await robotsFor(url.origin);
    if (robots) {
      const verdict = resolveRobotsRule(robots, url.pathname + url.search, 'Googlebot');
      if (!verdict.allowed) {
        return {
          url: loc,
          status: null,
          state: 'blocked',
          finalUrl: null,
          note: `Blocked by robots.txt (${formatRule(verdict.rule!)}). Listed in a sitemap, but forbidden to crawl.`,
        };
      }
    }

    try {
      const response = await safeFetch(
        loc,
        fetchOptions({ method: 'HEAD', timeoutMs: 5000, maxRedirects: 3 }),
      );
      return classifyStatus(loc, response.status, response.finalUrl);
    } catch (error) {
      if (error instanceof SafeFetchError && (error.code === 'TIMEOUT' || error.code === 'TOO_MANY_REDIRECTS')) {
        return {
          url: loc,
          status: null,
          state: 'unreachable',
          finalUrl: null,
          note: error.message,
        };
      }
      try {
        const getFallback = await safeFetch(
          loc,
          fetchOptions({ method: 'GET', timeoutMs: 5000, maxBodyBytes: 1024 }),
        );
        return classifyStatus(loc, getFallback.status, getFallback.finalUrl);
      } catch (inner) {
        const message = inner instanceof Error ? inner.message : 'Could not reach URL.';
        return {
          url: loc,
          status: null,
          state: 'unreachable',
          finalUrl: null,
          note: message,
        };
      }
    }
  }

  const pool = Array.from({ length: 4 }, () => worker());
  await Promise.all(pool);
  return results;
}

function classifyStatus(
  url: string,
  status: number,
  finalUrl: string,
): SitemapUrlCheck {
  let note: string | null = null;
  if (status >= 400 && status < 500) {
    if (status === 404) note = 'Returns 404 Not Found. Broken URLs in a sitemap waste crawl budget.';
    else if (status === 410) note = 'Returns 410 Gone. The page was deleted and should be removed from the sitemap.';
    else note = `Returns client error HTTP ${status}.`;
    return { url, status, state: 'client-error', finalUrl, note };
  }
  if (status >= 500) {
    return {
      url,
      status,
      state: 'server-error',
      finalUrl,
      note: `Returns server error HTTP ${status}.`,
    };
  }
  if (finalUrl !== url) {
    return {
      url,
      status,
      state: 'redirect',
      finalUrl,
      note: `Redirects to ${finalUrl}. Sitemaps should list the canonical destination, not redirect hops.`,
    };
  }
  return { url, status, state: 'ok', finalUrl, note };
}
