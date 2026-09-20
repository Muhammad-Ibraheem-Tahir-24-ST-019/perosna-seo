import { describe, expect, it } from 'vitest';
import { parseAndAudit } from '../../packages/validation/src/robots-audit.js';
import { parseRobotsTxt, resolveRobotsRule } from '../../packages/validation/src/robots.js';

const codes = (content: string) => parseAndAudit(content).audit.issues.map((issue) => issue.code);

describe('resolveRobotsRule', () => {
  it('reports which rule blocked a path', () => {
    const parsed = parseRobotsTxt('User-agent: *\nDisallow: /admin');
    const verdict = resolveRobotsRule(parsed, '/admin/settings', 'Googlebot');
    expect(verdict.allowed).toBe(false);
    expect(verdict.rule).toEqual({ type: 'disallow', path: '/admin' });
  });

  it('reports no rule when nothing matches', () => {
    const parsed = parseRobotsTxt('User-agent: *\nDisallow: /admin');
    const verdict = resolveRobotsRule(parsed, '/blog/post', 'Googlebot');
    expect(verdict.allowed).toBe(true);
    expect(verdict.rule).toBeNull();
  });

  it('lets the longest match win', () => {
    const parsed = parseRobotsTxt('User-agent: *\nDisallow: /docs\nAllow: /docs/public');
    expect(resolveRobotsRule(parsed, '/docs/public/a', 'Googlebot').rule?.path).toBe('/docs/public');
    expect(resolveRobotsRule(parsed, '/docs/private', 'Googlebot').rule?.path).toBe('/docs');
  });

  it('prefers a rule group that names the agent over the wildcard group', () => {
    const parsed = parseRobotsTxt(
      'User-agent: *\nDisallow: /\n\nUser-agent: Googlebot\nAllow: /\nDisallow: /private',
    );
    expect(resolveRobotsRule(parsed, '/anything', 'Googlebot').allowed).toBe(true);
    expect(resolveRobotsRule(parsed, '/private', 'Googlebot').allowed).toBe(false);
    expect(resolveRobotsRule(parsed, '/anything', 'Bingbot').allowed).toBe(false);
  });

  it('honours wildcard and end-anchor patterns', () => {
    const parsed = parseRobotsTxt('User-agent: *\nDisallow: /*.pdf$');
    expect(resolveRobotsRule(parsed, '/files/report.pdf', 'Googlebot').allowed).toBe(false);
    expect(resolveRobotsRule(parsed, '/files/report.pdf?v=1', 'Googlebot').allowed).toBe(true);
  });
});

describe('auditRobotsTxt - the mistakes the brief asks about', () => {
  it('flags an empty file', () => {
    expect(codes('')).toContain('robots-empty');
  });

  it('flags a file that blocks the whole site', () => {
    const found = codes('User-agent: *\nDisallow: /');
    expect(found).toContain('robots-blocks-all');
    expect(parseAndAudit('User-agent: *\nDisallow: /').audit.blocksEverything).toBe(true);
  });

  it('does not flag a site that only blocks a subtree', () => {
    const audit = parseAndAudit('User-agent: *\nDisallow: /admin\nSitemap: https://e.com/s.xml');
    expect(audit.audit.blocksEverything).toBe(false);
    expect(audit.audit.issues.map((i) => i.code)).not.toContain('robots-blocks-all');
  });

  it('flags a missing sitemap directive', () => {
    expect(codes('User-agent: *\nDisallow: /admin')).toContain('robots-no-sitemap');
  });

  it('does not flag a sitemap directive that is present', () => {
    expect(codes('User-agent: *\nDisallow:\nSitemap: https://example.com/sitemap.xml')).not.toContain(
      'robots-no-sitemap',
    );
  });

  it('flags an HTML page served as robots.txt', () => {
    expect(codes('<!doctype html><html><body>Not found</body></html>')).toContain('robots-is-html');
  });
});

describe('auditRobotsTxt - syntax errors', () => {
  it('flags a line with no colon', () => {
    expect(codes('User-agent: *\nDisallow /admin')).toContain('robots-missing-colon');
  });

  it('suggests a correction for a misspelled directive', () => {
    const issues = parseAndAudit('User-agent: *\nDissallow: /admin').audit.issues;
    const typo = issues.find((issue) => issue.code === 'robots-typo');
    expect(typo?.message).toContain('disallow');
    expect(typo?.line).toBe(2);
  });

  it('flags a path with no leading slash', () => {
    expect(codes('User-agent: *\nDisallow: admin')).toContain('robots-path-no-slash');
  });

  it('flags a full URL used as a path', () => {
    expect(codes('User-agent: *\nDisallow: https://example.com/admin')).toContain(
      'robots-path-is-url',
    );
  });

  it('flags a relative sitemap URL', () => {
    expect(codes('User-agent: *\nDisallow:\nSitemap: /sitemap.xml')).toContain(
      'robots-sitemap-relative',
    );
  });

  it('flags rules written before any user-agent line', () => {
    expect(codes('Disallow: /admin\nUser-agent: *')).toContain('robots-rules-before-agent');
  });

  it('flags a file with no user-agent at all', () => {
    expect(codes('Sitemap: https://example.com/sitemap.xml')).toContain('robots-no-agent');
  });

  it('flags an unknown directive', () => {
    expect(codes('User-agent: *\nCrawl-rate: 5')).toContain('robots-unknown-field');
  });

  it('notes that Googlebot ignores crawl-delay', () => {
    expect(codes('User-agent: *\nCrawl-delay: 10')).toContain('robots-crawl-delay-ignored');
  });

  it('flags duplicate wildcard groups', () => {
    expect(codes('User-agent: *\nDisallow: /a\n\nUser-agent: *\nDisallow: /b')).toContain(
      'robots-duplicate-agent',
    );
  });

  it('reports accurate line numbers', () => {
    const issues = parseAndAudit('# comment\nUser-agent: *\n\nDisallow admin').audit.issues;
    expect(issues.find((issue) => issue.code === 'robots-missing-colon')?.line).toBe(4);
  });

  it('counts stats', () => {
    const { audit } = parseAndAudit(
      'User-agent: *\nDisallow: /a\nAllow: /b\nSitemap: https://e.com/s.xml',
    );
    expect(audit.stats.groups).toBe(1);
    expect(audit.stats.rules).toBe(2);
    expect(audit.stats.sitemaps).toBe(1);
  });

  it('never throws on hostile input', () => {
    for (const bad of ['\u0000', ':::::', 'a'.repeat(10_000), '\n'.repeat(1000)]) {
      expect(() => parseAndAudit(bad)).not.toThrow();
    }
  });
});
