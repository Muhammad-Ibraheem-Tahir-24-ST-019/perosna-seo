import { describe, expect, it } from 'vitest';
import { isPathAllowed, parseRobotsTxt } from '../../packages/validation/src/robots.js';
import {
  extractHtmlSignals,
  isHtmlContentType,
  parseXRobotsTag,
} from '../../packages/validation/src/html.js';

describe('robots.txt', () => {
  const sample = `
User-agent: *
Disallow: /private/
Allow: /private/public-page
Disallow: /*.pdf$

User-agent: IndexPilotBot
Disallow: /no-bots/

Sitemap: https://example.com/sitemap.xml
`;

  it('parses groups and sitemaps', () => {
    const parsed = parseRobotsTxt(sample);
    expect(parsed.sitemaps).toEqual(['https://example.com/sitemap.xml']);
    expect(parsed.groups).toHaveLength(2);
  });

  it('applies the agent-specific group when one matches', () => {
    const parsed = parseRobotsTxt(sample);
    expect(isPathAllowed(parsed, '/no-bots/page', 'IndexPilotBot/1.0')).toBe(false);
    // The specific group replaces the wildcard group entirely.
    expect(isPathAllowed(parsed, '/private/secret', 'IndexPilotBot/1.0')).toBe(true);
  });

  it('applies wildcard rules for other agents, longest match wins', () => {
    const parsed = parseRobotsTxt(sample);
    expect(isPathAllowed(parsed, '/private/secret', 'SomeOtherBot')).toBe(false);
    expect(isPathAllowed(parsed, '/private/public-page', 'SomeOtherBot')).toBe(true);
    expect(isPathAllowed(parsed, '/files/report.pdf', 'SomeOtherBot')).toBe(false);
    expect(isPathAllowed(parsed, '/blog/post', 'SomeOtherBot')).toBe(true);
  });

  it('treats an empty Disallow as allow-all', () => {
    const parsed = parseRobotsTxt('User-agent: *\nDisallow:\n');
    expect(isPathAllowed(parsed, '/anything', 'AnyBot')).toBe(true);
  });

  it('allows everything when no group applies', () => {
    const parsed = parseRobotsTxt('# nothing here\n');
    expect(isPathAllowed(parsed, '/page', 'AnyBot')).toBe(true);
  });
});

describe('HTML indexability signals', () => {
  it('detects meta robots noindex', () => {
    const signals = extractHtmlSignals(
      '<html><head><meta name="robots" content="noindex, follow"></head><body></body></html>',
      'https://example.com/page',
    );
    expect(signals.noindex).toBe(true);
    expect(signals.nofollow).toBe(false);
  });

  it('detects googlebot-specific noindex and "none"', () => {
    expect(
      extractHtmlSignals(
        '<head><meta name="googlebot" content="none"></head>',
        'https://example.com/',
      ).noindex,
    ).toBe(true);
  });

  it('ignores unrelated meta tags', () => {
    const signals = extractHtmlSignals(
      '<head><meta name="description" content="noindex mentioned in text"></head>',
      'https://example.com/',
    );
    expect(signals.noindex).toBe(false);
  });

  it('resolves relative canonical URLs', () => {
    const signals = extractHtmlSignals(
      '<head><link rel="canonical" href="/canonical-page"><title>Hello</title></head>',
      'https://example.com/some/page',
    );
    expect(signals.canonicalUrl).toBe('https://example.com/canonical-page');
    expect(signals.title).toBe('Hello');
  });

  it('parses X-Robots-Tag headers, including agent-prefixed forms', () => {
    expect(parseXRobotsTag('noindex').noindex).toBe(true);
    expect(parseXRobotsTag('googlebot: noindex').noindex).toBe(true);
    expect(parseXRobotsTag('nofollow').noindex).toBe(false);
    expect(parseXRobotsTag(null).noindex).toBe(false);
  });

  it('recognises HTML content types', () => {
    expect(isHtmlContentType('text/html; charset=utf-8')).toBe(true);
    expect(isHtmlContentType('application/xhtml+xml')).toBe(true);
    expect(isHtmlContentType('application/pdf')).toBe(false);
    expect(isHtmlContentType(null)).toBe(false);
  });
});
