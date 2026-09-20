import { safeFetch, SafeFetchError, type SafeFetchOptions } from './fetcher.js';

export interface RobotsRule {
  type: 'allow' | 'disallow';
  path: string;
}

export interface RobotsGroup {
  agents: string[];
  rules: RobotsRule[];
}

export interface ParsedRobots {
  groups: RobotsGroup[];
  sitemaps: string[];
}

/**
 * Minimal but standards-shaped robots.txt parser: group merging by user-agent,
 * longest-match wins, Allow beats Disallow on equal length.
 */
export function parseRobotsTxt(content: string): ParsedRobots {
  const groups: RobotsGroup[] = [];
  const sitemaps: string[] = [];
  let current: RobotsGroup | null = null;
  let lastLineWasAgent = false;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.split('#')[0]?.trim() ?? '';
    if (!line) continue;
    const separator = line.indexOf(':');
    if (separator === -1) continue;
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    if (field === 'user-agent') {
      if (!current || !lastLineWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastLineWasAgent = true;
      continue;
    }
    lastLineWasAgent = false;
    if (field === 'sitemap') {
      sitemaps.push(value);
      continue;
    }
    if (!current) continue;
    if (field === 'allow') current.rules.push({ type: 'allow', path: value });
    if (field === 'disallow') current.rules.push({ type: 'disallow', path: value });
  }

  return { groups, sitemaps };
}

/** Returns true when `userAgent` may fetch `path` according to the parsed file. */
export function isPathAllowed(robots: ParsedRobots, path: string, userAgent: string): boolean {
  const agent = userAgent.toLowerCase();
  const specific = robots.groups.filter((group) =>
    group.agents.some((candidate) => candidate !== '*' && agent.includes(candidate)),
  );
  const wildcard = robots.groups.filter((group) => group.agents.includes('*'));
  const applicable = specific.length > 0 ? specific : wildcard;
  if (applicable.length === 0) return true;

  let best: { rule: RobotsRule; length: number } | null = null;
  for (const group of applicable) {
    for (const rule of group.rules) {
      if (rule.path === '') {
        // "Disallow:" with an empty value means allow everything.
        if (rule.type === 'disallow') continue;
      }
      if (!matchesRobotsPattern(rule.path, path)) continue;
      const length = rule.path.replace(/\$$/, '').length;
      if (!best || length > best.length || (length === best.length && rule.type === 'allow')) {
        best = { rule, length };
      }
    }
  }
  if (!best) return true;
  return best.rule.type === 'allow';
}

/**
 * Same resolution as `isPathAllowed`, but returns the rule that decided the
 * verdict so the UI can show the user *why* a path is blocked. "Blocked" on its
 * own is not actionable; "blocked by `Disallow: /admin` in the `*` group" is.
 */
export function resolveRobotsRule(
  robots: ParsedRobots,
  path: string,
  userAgent: string,
): { allowed: boolean; rule: RobotsRule | null; group: RobotsGroup | null } {
  const agent = userAgent.toLowerCase();
  const specific = robots.groups.filter((group) =>
    group.agents.some((candidate) => candidate !== '*' && agent.includes(candidate)),
  );
  const wildcard = robots.groups.filter((group) => group.agents.includes('*'));
  const applicable = specific.length > 0 ? specific : wildcard;
  if (applicable.length === 0) return { allowed: true, rule: null, group: null };

  let best: { rule: RobotsRule; group: RobotsGroup; length: number } | null = null;
  for (const group of applicable) {
    for (const rule of group.rules) {
      if (rule.path === '' && rule.type === 'disallow') continue;
      if (!matchesRobotsPattern(rule.path, path)) continue;
      const length = rule.path.replace(/\$$/, '').length;
      if (!best || length > best.length || (length === best.length && rule.type === 'allow')) {
        best = { rule, group, length };
      }
    }
  }
  if (!best) return { allowed: true, rule: null, group: null };
  return { allowed: best.rule.type === 'allow', rule: best.rule, group: best.group };
}

export function matchesRobotsPattern(pattern: string, path: string): boolean {
  if (pattern === '') return false;
  const mustEnd = pattern.endsWith('$');
  const core = mustEnd ? pattern.slice(0, -1) : pattern;
  const segments = core.split('*');

  let index = 0;
  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i] as string;
    if (segment === '') continue;
    const found = i === 0 ? (path.startsWith(segment) ? 0 : -1) : path.indexOf(segment, index);
    if (found === -1) return false;
    index = found + segment.length;
  }
  if (mustEnd) {
    const tail = segments[segments.length - 1] as string;
    return tail === '' ? true : path.endsWith(tail);
  }
  return true;
}

export interface RobotsCheckResult {
  allowed: boolean | null;
  /** Why the verdict is null (fetch failure), for diagnostics. */
  note: string | null;
  sitemaps: string[];
}

/**
 * Fetches and evaluates robots.txt for the origin of `url`.
 *
 * A missing or unreachable robots.txt is treated as "allowed" per the standard;
 * a fetch error yields `allowed: null` so the UI can show it as unknown rather
 * than as a hard block.
 */
export async function checkRobots(
  url: URL,
  userAgent: string,
  options: SafeFetchOptions = {},
): Promise<RobotsCheckResult> {
  const robotsUrl = new URL('/robots.txt', url.origin).toString();
  try {
    const response = await safeFetch(robotsUrl, { ...options, method: 'GET' });
    if (response.status === 404 || response.status === 410) {
      return { allowed: true, note: 'No robots.txt published.', sitemaps: [] };
    }
    if (response.status >= 500) {
      return {
        allowed: null,
        note: `robots.txt returned HTTP ${response.status}.`,
        sitemaps: [],
      };
    }
    if (response.status >= 400) {
      return { allowed: true, note: `robots.txt returned HTTP ${response.status}.`, sitemaps: [] };
    }
    const parsed = parseRobotsTxt(response.body);
    return {
      allowed: isPathAllowed(parsed, url.pathname + url.search, userAgent),
      note: null,
      sitemaps: parsed.sitemaps,
    };
  } catch (error) {
    const message = error instanceof SafeFetchError ? error.message : 'robots.txt fetch failed.';
    return { allowed: null, note: message, sitemaps: [] };
  }
}
