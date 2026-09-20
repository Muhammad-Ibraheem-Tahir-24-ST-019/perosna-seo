import { createHash } from 'node:crypto';
import { env } from '@indexpilot/config';
import { prisma, type Prisma } from '@indexpilot/db';
import { badRequest, type ToolEngineKey } from '@indexpilot/shared';
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
  type PageMetaReport,
  type ParsedSitemap,
  type RobotsAudit,
  type SafeFetchOptions,
  type SitemapEntry,
  type SsrfPolicy,
} from '@indexpilot/validation';
import { readCache, writeCache } from '../lib/tool-cache.js';
import { logger } from '../lib/logger.js';

/**
 * The public SEO tools.
 *
 * Every function here fetches a URL the caller chose, so the rules are stricter
 * than anywhere else in the API:
 *  - the same SSRF policy as the paid pipeline, with no relaxations;
 *  - a hard cap on how many requests one call can make against a target site,
 *    so the tool cannot be used to flood someone else's server;
 *  - robots.txt is honoured when we crawl a sitemap's URLs, because a tool that
 *    checks robots compliance must not itself ignore it;
 *  - results are cached briefly so repeat checks do not re-hit the target.
 */

function ssrfPolicy(): SsrfPolicy {
  return { ...DEFAULT_SSRF_POLICY, allowPrivateNetwork: env.ALLOW_PRIVATE_NETWORK_FETCH };
}

function fetchOptions(overrides: SafeFetchOptions = {}): SafeFetchOptions {
  return {
    policy: ssrfPolicy(),
    timeoutMs: env.TOOLS_FETCH_TIMEOUT_MS,
    maxRedirects: env.FETCH_MAX_REDIRECTS,
    userAgent: env.FETCH_USER_AGENT,
    ...overrides,
  };
}

export interface ToolMeta {
  /** True when this response came from the short-lived result cache. */
  cached: boolean;
  /** Age of the cached result in seconds; 0 for a fresh fetch. */
  cacheAgeSeconds: number;
  durationMs: number;
  checkedAt: string;
}

/** Normalises free-text input ("example.com", "https://example.com/a") to a URL. */
export function resolveTarget(input: string): URL {
  const trimmed = input.trim();
  if (!trimmed) throw badRequest('Enter a URL or domain to check.');

  const normalized = normalizeUrl(trimmed);
  if (isNormalizeFailure(normalized)) {
    throw badRequest(normalized.message);
  }
  return new URL(normalized.normalizedUrl);
}

// ---------------------------------------------------------------------------
// Tool 1 - robots.txt tester
// ---------------------------------------------------------------------------

export interface RobotsPathVerdict {
  path: string;
  userAgent: string;
  allowed: boolean;
  /** The directive that decided it, e.g. "Disallow: /admin". Null when no rule matched. */
  matchedRule: string | null;
  explanation: string;
}

export interface RobotsToolResult {
  input: string;
  robotsUrl: string;
  finalUrl: string;
  status: number;
  /** False when there is no robots.txt at all, which is itself a valid state. */
  exists: boolean;
  content: string | null;
  contentType: string | null;
  audit: RobotsAudit;
  sitemaps: string[];
  groups: { agents: string[]; rules: { type: string; path: string }[] }[];
  tests: RobotsPathVerdict[];
  error: { code: string; message: string } | null;
}

const MAX_ROBOTS_TESTS = 25;

export async function runRobotsTool(
  rawInput: string,
  options: { paths?: string[]; userAgent?: string } = {},
): Promise<{ result: RobotsToolResult; meta: ToolMeta }> {
  const startedAt = Date.now();
  const target = resolveTarget(rawInput);
  const robotsUrl = new URL('/robots.txt', target.origin).toString();
  const testAgent = (options.userAgent ?? 'Googlebot').slice(0, 120);

  // Paths are evaluated locally against the fetched file, so they do not change
  // what we request and can therefore share one cache entry per origin.
  const cacheKey = robotsUrl;
  const cached = await readCache<Omit<RobotsToolResult, 'tests' | 'input'>>('robots', cacheKey);

  let base: Omit<RobotsToolResult, 'tests' | 'input'>;
  let cacheAgeSeconds = 0;

  if (cached) {
    base = cached.value;
    cacheAgeSeconds = cached.ageSeconds;
  } else {
    base = await fetchRobots(robotsUrl);
    await writeCache('robots', cacheKey, base);
  }

  // The user's own path goes first so the answer they asked for is at the top.
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
          'There is no robots.txt on this domain, and the standard treats a missing file as "crawl everything".',
      };
    }
    const verdict = resolveRobotsRule(parsed, normalisedPath, testAgent);
    return {
      path: normalisedPath,
      userAgent: testAgent,
      allowed: verdict.allowed,
      matchedRule: verdict.rule ? formatRule(verdict.rule) : null,
      explanation: explainVerdict(verdict, testAgent, normalisedPath),
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

function explainVerdict(
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
          message: `robots.txt returned HTTP ${response.status}. Crawlers treat a 5xx as "block everything" until it recovers.`,
        },
      };
    }

    const content = response.body;
    const parsed = parseRobotsTxt(content);
    return {
      robotsUrl,
      finalUrl: response.finalUrl,
      status: response.status,
      exists: true,
      content,
      contentType: response.contentType,
      audit: auditRobotsTxt(content, parsed),
      sitemaps: parsed.sitemaps,
      groups: parsed.groups.map((group) => ({
        agents: group.agents,
        rules: group.rules.map((rule) => ({ type: rule.type, path: rule.path })),
      })),
      error: null,
    };
  } catch (error) {
    const message =
      error instanceof SafeFetchError ? error.message : 'robots.txt could not be fetched.';
    const code = error instanceof SafeFetchError ? error.code : 'NETWORK_ERROR';
    return {
      ...empty,
      audit: auditRobotsTxt('', { groups: [], sitemaps: [] }),
      error: { code, message },
    };
  }
}

// ---------------------------------------------------------------------------
// Tools 2 & 3 - meta title/description and canonical
// ---------------------------------------------------------------------------

export interface MetaToolResult {
  input: string;
  requestedUrl: string;
  finalUrl: string;
  status: number;
  contentType: string | null;
  redirectCount: number;
  redirectChain: string[];
  /** X-Robots-Tag, which overrides the meta tag and is easy to miss. */
  xRobotsTag: string | null;
  report: PageMetaReport | null;
  robotsTxtAllowed: boolean | null;
  robotsTxtNote: string | null;
  error: { code: string; message: string } | null;
}

export async function runMetaTool(
  rawInput: string,
): Promise<{ result: MetaToolResult; meta: ToolMeta }> {
  const startedAt = Date.now();
  const target = resolveTarget(rawInput);
  const cacheKey = target.toString();

  const cached = await readCache<Omit<MetaToolResult, 'input'>>('meta', cacheKey);
  let base: Omit<MetaToolResult, 'input'>;
  let cacheAgeSeconds = 0;

  if (cached) {
    base = cached.value;
    cacheAgeSeconds = cached.ageSeconds;
  } else {
    base = await fetchPageMeta(target);
    await writeCache('meta', cacheKey, base);
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
    const message = error instanceof SafeFetchError ? error.message : 'The page could not be fetched.';
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
// Tool 4 - sitemap checker
// ---------------------------------------------------------------------------

export type SitemapUrlState = 'ok' | 'redirect' | 'client-error' | 'server-error' | 'blocked' | 'unreachable';

export interface SitemapUrlCheck {
  url: string;
  status: number | null;
  state: SitemapUrlState;
  finalUrl: string | null;
  note: string | null;
}

export interface SitemapToolResult {
  input: string;
  /** Every sitemap URL we considered and where the candidate came from. */
  discovery: { source: string; url: string; used: boolean }[];
  robotsSitemaps: string[];
  robotsError: string | null;
  sitemapUrl: string | null;
  kind: string;
  totalEntries: number;
  /** Nested sitemaps, when the target was an index. */
  childSitemaps: { url: string; entries: number; error: string | null }[];
  entries: SitemapEntry[];
  issues: ParsedSitemap['issues'];
  checked: SitemapUrlCheck[];
  summary: {
    checkedCount: number;
    okCount: number;
    redirectCount: number;
    brokenCount: number;
    blockedCount: number;
    /** How many URLs were left unchecked because of the per-run cap. */
    notCheckedCount: number;
    limit: number;
  };
  error: { code: string; message: string } | null;
}

/** Follows at most this many child sitemaps from an index, to bound the work. */
const MAX_CHILD_SITEMAPS = 5;

export async function runSitemapTool(
  rawInput: string,
  options: { urlCheckLimit: number; checkUrls?: boolean } = { urlCheckLimit: 0 },
): Promise<{ result: SitemapToolResult; meta: ToolMeta }> {
  const startedAt = Date.now();
  const target = resolveTarget(rawInput);
  const checkUrls = options.checkUrls !== false && options.urlCheckLimit > 0;
  const cacheKey = `${target.toString()}|limit=${options.urlCheckLimit}|check=${checkUrls}`;

  const cached = await readCache<Omit<SitemapToolResult, 'input'>>('sitemap', cacheKey);
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

  const base = await inspectSitemap(target, options.urlCheckLimit, checkUrls);
  await writeCache('sitemap', cacheKey, base);

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

  // Walk the candidates in order and keep the first one that actually parses.
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
    // An explicitly provided URL is reported as-is rather than skipped, so the
    // user sees why the URL they gave us did not work.
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

  // A sitemap index lists sitemaps, not pages. Follow a bounded number of them
  // so the URL check has real URLs to work with.
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

  const checked = checkUrls
    ? await checkSitemapUrls(entries, urlCheckLimit)
    : [];

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
    // Cap what is sent to the browser; the counts above cover the whole file.
    entries: entries.slice(0, 1000),
    issues,
    checked,
    summary,
    error: null,
  };
}

/**
 * Checks the HTTP status of sitemap URLs, capped and rate-limited.
 *
 * Two safeguards the brief calls for explicitly:
 *  - `limit` bounds how many requests one call can make, so a sitemap with
 *    50,000 URLs cannot turn this endpoint into a flood against that site;
 *  - robots.txt for the target origin is fetched once and honoured, so the tool
 *    does not crawl what it would tell you not to crawl.
 */
async function checkSitemapUrls(
  entries: SitemapEntry[],
  limit: number,
): Promise<SitemapUrlCheck[]> {
  const slice = entries.slice(0, limit);
  if (slice.length === 0) return [];

  // One robots.txt fetch per origin, reused for every URL on that origin.
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
      parsed = null; // Unreachable robots.txt means "no restrictions recorded".
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
        note: 'This is not a valid absolute URL, so it cannot be crawled.',
      };
    }

    const robots = await robotsFor(url.origin);
    if (robots) {
      const verdict = resolveRobotsRule(robots, url.pathname + url.search, env.FETCH_USER_AGENT);
      if (!verdict.allowed) {
        return {
          url: loc,
          status: null,
          state: 'blocked',
          finalUrl: null,
          note: `Listed in the sitemap but blocked by robots.txt (${verdict.rule ? formatRule(verdict.rule) : 'a disallow rule'}). Search engines will not crawl it.`,
        };
      }
    }

    try {
      // HEAD first: it is the polite request for a status check.
      const response = await safeFetch(
        loc,
        fetchOptions({ method: 'HEAD', maxRedirects: 0, timeoutMs: 8_000 }),
      );
      return classify(loc, response.status, response.finalUrl, null);
    } catch (error) {
      if (error instanceof SafeFetchError && error.code === 'TOO_MANY_REDIRECTS') {
        return {
          url: loc,
          status: 301,
          state: 'redirect',
          finalUrl: null,
          note: 'This URL redirects. A sitemap should list the destination, not the redirect.',
        };
      }
      // Some servers reject HEAD outright; fall back to a capped GET.
      try {
        const response = await safeFetch(
          loc,
          fetchOptions({ method: 'GET', maxRedirects: 0, timeoutMs: 8_000, maxBodyBytes: 2048 }),
        );
        return classify(loc, response.status, response.finalUrl, null);
      } catch (retryError) {
        const message =
          retryError instanceof SafeFetchError ? retryError.message : 'The URL could not be reached.';
        return { url: loc, status: null, state: 'unreachable', finalUrl: null, note: message };
      }
    }
  }

  const concurrency = Math.min(env.TOOLS_SITEMAP_CONCURRENCY, slice.length);
  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  return results.filter(Boolean);
}

function classify(
  url: string,
  status: number,
  finalUrl: string,
  note: string | null,
): SitemapUrlCheck {
  if (status >= 300 && status < 400) {
    return {
      url,
      status,
      state: 'redirect',
      finalUrl,
      note: note ?? 'This URL redirects. A sitemap should list the final destination instead.',
    };
  }
  if (status >= 500) {
    return { url, status, state: 'server-error', finalUrl, note: note ?? 'The server errored on this URL.' };
  }
  if (status >= 400) {
    return {
      url,
      status,
      state: 'client-error',
      finalUrl,
      note: note ?? `Returns HTTP ${status}. Remove it from the sitemap or fix the page.`,
    };
  }
  return { url, status, state: 'ok', finalUrl, note };
}

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

/**
 * IPs are hashed with the session secret before storage: enough to count unique
 * users and investigate abuse, not enough to re-identify a visitor from the
 * table. Nothing in the product needs the raw address.
 */
export function hashIp(ip: string): string {
  return createHash('sha256').update(`${env.SESSION_SECRET}:${ip}`).digest('hex').slice(0, 32);
}

export interface RecordRunInput {
  toolSlug: string;
  toolId: string | null;
  engine: ToolEngineKey;
  userId: string | null;
  ip: string | null;
  targetHost: string | null;
  outcome: 'COMPLETED' | 'FETCH_FAILED' | 'BLOCKED' | 'INVALID_INPUT' | 'RATE_LIMITED';
  cached: boolean;
  issueCount: number;
  durationMs: number;
}

/** Fire-and-forget: analytics must never fail a user's request. */
export function recordToolRun(input: RecordRunInput): void {
  const data: Prisma.ToolRunUncheckedCreateInput = {
    toolId: input.toolId,
    toolSlug: input.toolSlug,
    engine: input.engine,
    userId: input.userId,
    ipHash: input.ip ? hashIp(input.ip) : null,
    targetHost: input.targetHost?.slice(0, 255) ?? null,
    outcome: input.outcome,
    cached: input.cached,
    issueCount: input.issueCount,
    durationMs: input.durationMs,
  };
  void prisma.toolRun.create({ data }).catch((error: unknown) => {
    logger.debug({ err: error }, 'tool run not recorded');
  });
}
