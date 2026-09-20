/**
 * Lint pass for a robots.txt file.
 *
 * `robots.ts` answers "is this path allowed" — the parser is deliberately
 * forgiving, because that is how real crawlers behave. This module answers the
 * other question: "what is wrong with this file". It therefore walks the raw
 * lines itself (keeping line numbers) instead of reusing the tolerant parser,
 * since the whole point is to surface what the tolerant parser silently ignored.
 */

import { parseRobotsTxt, resolveRobotsRule, type ParsedRobots, type RobotsRule } from './robots.js';

export type RobotsIssueSeverity = 'error' | 'warning' | 'info';

export interface RobotsIssue {
  severity: RobotsIssueSeverity;
  /** Stable key for the "how to fix" copy on the tool page. */
  code: string;
  message: string;
  line: number | null;
  excerpt: string | null;
}

/** Fields a crawler understands. Anything else is a typo or a non-standard extension. */
const KNOWN_FIELDS = new Set([
  'user-agent',
  'allow',
  'disallow',
  'sitemap',
  'crawl-delay',
  'host',
  'clean-param',
  'noindex',
  'request-rate',
  'visit-time',
]);

/** Fields no major crawler honours, but that people keep writing anyway. */
const IGNORED_FIELDS = new Set(['noindex', 'host', 'request-rate', 'visit-time', 'clean-param']);

const COMMON_TYPOS: Record<string, string> = {
  'user agent': 'user-agent',
  useragent: 'user-agent',
  'user-agents': 'user-agent',
  disallowed: 'disallow',
  dissallow: 'disallow',
  disalow: 'disallow',
  allowed: 'allow',
  sitemaps: 'sitemap',
  'site-map': 'sitemap',
  crawldelay: 'crawl-delay',
};

export interface RobotsAudit {
  issues: RobotsIssue[];
  stats: {
    lines: number;
    groups: number;
    rules: number;
    sitemaps: number;
    comments: number;
  };
  /** True when nothing on the site can be crawled by the default agent. */
  blocksEverything: boolean;
}

export function auditRobotsTxt(content: string, parsed: ParsedRobots): RobotsAudit {
  const issues: RobotsIssue[] = [];
  const lines = content.split(/\r?\n/);
  let comments = 0;
  let sawUserAgent = false;
  let directivesBeforeAgent = 0;

  if (content.trim() === '') {
    issues.push({
      severity: 'warning',
      code: 'robots-empty',
      message:
        'The file is empty. An empty robots.txt allows everything — which may be what you want, but it is usually a deployment mistake.',
      line: null,
      excerpt: null,
    });
  }

  if (content.charCodeAt(0) === 0xfeff) {
    issues.push({
      severity: 'error',
      code: 'robots-bom',
      message:
        'The file starts with a UTF-8 byte-order mark. Some crawlers fail to read the first directive because of it.',
      line: 1,
      excerpt: null,
    });
  }

  if (/<html|<!doctype/i.test(content.slice(0, 500))) {
    issues.push({
      severity: 'error',
      code: 'robots-is-html',
      message:
        'This is an HTML page, not a robots.txt file. The server is most likely returning your 404 page with a 200 status.',
      line: 1,
      excerpt: lines[0]?.slice(0, 120) ?? null,
    });
  }

  lines.forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const withoutComment = rawLine.split('#')[0] ?? '';
    if (rawLine.includes('#')) comments += 1;
    const line = withoutComment.trim();
    if (line === '') return;

    const separator = line.indexOf(':');
    if (separator === -1) {
      issues.push({
        severity: 'error',
        code: 'robots-missing-colon',
        message: `Line ${lineNumber} has no colon, so it is not a directive and every crawler ignores it.`,
        line: lineNumber,
        excerpt: line.slice(0, 120),
      });
      return;
    }

    const rawField = line.slice(0, separator).trim();
    const field = rawField.toLowerCase();
    const value = line.slice(separator + 1).trim();

    const suggestion = COMMON_TYPOS[field];
    if (suggestion) {
      issues.push({
        severity: 'error',
        code: 'robots-typo',
        message: `Line ${lineNumber}: "${rawField}" is not a directive. Did you mean "${suggestion}"?`,
        line: lineNumber,
        excerpt: line.slice(0, 120),
      });
      return;
    }

    if (!KNOWN_FIELDS.has(field)) {
      issues.push({
        severity: 'warning',
        code: 'robots-unknown-field',
        message: `Line ${lineNumber}: "${rawField}" is not a robots.txt directive and will be ignored.`,
        line: lineNumber,
        excerpt: line.slice(0, 120),
      });
      return;
    }

    if (field === 'user-agent') {
      sawUserAgent = true;
      if (value === '') {
        issues.push({
          severity: 'error',
          code: 'robots-empty-agent',
          message: `Line ${lineNumber}: User-agent has no value. Use "User-agent: *" to address every crawler.`,
          line: lineNumber,
          excerpt: line.slice(0, 120),
        });
      }
      return;
    }

    if ((field === 'allow' || field === 'disallow') && !sawUserAgent) {
      directivesBeforeAgent += 1;
    }

    if (field === 'allow' || field === 'disallow') {
      if (value !== '' && !value.startsWith('/') && !value.startsWith('*')) {
        issues.push({
          severity: 'error',
          code: 'robots-path-no-slash',
          message: `Line ${lineNumber}: "${value}" must start with "/" — a path without a leading slash does not match anything.`,
          line: lineNumber,
          excerpt: line.slice(0, 120),
        });
      }
      if (/^https?:\/\//i.test(value)) {
        issues.push({
          severity: 'error',
          code: 'robots-path-is-url',
          message: `Line ${lineNumber}: ${field === 'allow' ? 'Allow' : 'Disallow'} takes a path, not a full URL. Use the path part only.`,
          line: lineNumber,
          excerpt: line.slice(0, 120),
        });
      }
      if (value.includes(' ')) {
        issues.push({
          severity: 'warning',
          code: 'robots-path-space',
          message: `Line ${lineNumber}: the path contains a space. Spaces are not escaped in robots.txt and usually mean two directives were written on one line.`,
          line: lineNumber,
          excerpt: line.slice(0, 120),
        });
      }
      return;
    }

    if (field === 'sitemap') {
      if (!/^https?:\/\//i.test(value)) {
        issues.push({
          severity: 'error',
          code: 'robots-sitemap-relative',
          message: `Line ${lineNumber}: the Sitemap directive must be an absolute URL starting with http:// or https://.`,
          line: lineNumber,
          excerpt: line.slice(0, 120),
        });
      }
      return;
    }

    if (field === 'crawl-delay') {
      if (value === '' || Number.isNaN(Number(value))) {
        issues.push({
          severity: 'warning',
          code: 'robots-crawl-delay-invalid',
          message: `Line ${lineNumber}: Crawl-delay should be a number of seconds.`,
          line: lineNumber,
          excerpt: line.slice(0, 120),
        });
      } else {
        issues.push({
          severity: 'info',
          code: 'robots-crawl-delay-ignored',
          message: `Line ${lineNumber}: Googlebot ignores Crawl-delay. Set the crawl rate in Search Console instead. Bing and Yandex do honour it.`,
          line: lineNumber,
          excerpt: line.slice(0, 120),
        });
      }
      return;
    }

    if (IGNORED_FIELDS.has(field)) {
      issues.push({
        severity: 'info',
        code: 'robots-field-ignored',
        message: `Line ${lineNumber}: "${rawField}" is not honoured by Google. It is safe to leave, but it does nothing.`,
        line: lineNumber,
        excerpt: line.slice(0, 120),
      });
    }
  });

  if (directivesBeforeAgent > 0) {
    issues.push({
      severity: 'error',
      code: 'robots-rules-before-agent',
      message:
        'There are Allow/Disallow rules before any User-agent line. Rules that are not inside a group are ignored by every crawler.',
      line: null,
      excerpt: null,
    });
  }

  const ruleCount = parsed.groups.reduce((sum, group) => sum + group.rules.length, 0);

  // The check that matters most: is the whole site blocked?
  const rootVerdict = resolveRobotsRule(parsed, '/', 'Googlebot');
  const blocksEverything = rootVerdict.allowed === false;
  if (blocksEverything) {
    issues.push({
      severity: 'error',
      code: 'robots-blocks-all',
      message:
        'This file blocks Googlebot from the entire site. Nothing will be crawled while this rule is live.',
      line: null,
      excerpt: rootVerdict.rule ? formatRule(rootVerdict.rule) : null,
    });
  }

  if (parsed.sitemaps.length === 0 && content.trim() !== '') {
    issues.push({
      severity: 'warning',
      code: 'robots-no-sitemap',
      message:
        'No Sitemap directive. Adding one is the cheapest way to help crawlers find every URL on the site.',
      line: null,
      excerpt: null,
    });
  }

  if (!sawUserAgent && content.trim() !== '') {
    issues.push({
      severity: 'error',
      code: 'robots-no-agent',
      message:
        'No User-agent line. Without one, none of the Allow/Disallow rules in this file apply to anything.',
      line: null,
      excerpt: null,
    });
  }

  const wildcardGroups = parsed.groups.filter((group) => group.agents.includes('*'));
  if (wildcardGroups.length > 1) {
    issues.push({
      severity: 'warning',
      code: 'robots-duplicate-agent',
      message: `"User-agent: *" appears in ${wildcardGroups.length} separate groups. Crawlers only use one of them, so rules you expect to apply may not.`,
      line: null,
      excerpt: null,
    });
  }

  return {
    issues,
    stats: {
      lines: lines.length,
      groups: parsed.groups.length,
      rules: ruleCount,
      sitemaps: parsed.sitemaps.length,
      comments,
    },
    blocksEverything,
  };
}

export function formatRule(rule: RobotsRule): string {
  return `${rule.type === 'allow' ? 'Allow' : 'Disallow'}: ${rule.path}`;
}

/** Convenience wrapper: parse and audit in one call. */
export function parseAndAudit(content: string): { parsed: ParsedRobots; audit: RobotsAudit } {
  const parsed = parseRobotsTxt(content);
  return { parsed, audit: auditRobotsTxt(content, parsed) };
}
