import { describe, expect, it } from 'vitest';
import {
  SITEMAP_NAMESPACE,
  decodeXml,
  parseSitemapXml,
} from '../../packages/validation/src/sitemap.js';

function urlset(body: string, ns = SITEMAP_NAMESPACE): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="${ns}">${body}</urlset>`;
}

const codes = (result: ReturnType<typeof parseSitemapXml>) =>
  result.issues.map((issue) => issue.code);

describe('parseSitemapXml - structure', () => {
  it('parses a valid urlset', () => {
    const xml = urlset(
      '<url><loc>https://example.com/a</loc><lastmod>2024-01-15</lastmod><priority>0.8</priority></url>' +
        '<url><loc>https://example.com/b</loc></url>',
    );
    const result = parseSitemapXml(xml, xml.length);
    expect(result.kind).toBe('urlset');
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0]).toMatchObject({
      loc: 'https://example.com/a',
      lastmod: '2024-01-15',
      priority: '0.8',
    });
    expect(result.issues).toHaveLength(0);
  });

  it('parses a sitemap index', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="${SITEMAP_NAMESPACE}"><sitemap><loc>https://example.com/s1.xml</loc></sitemap></sitemapindex>`;
    const result = parseSitemapXml(xml, xml.length);
    expect(result.kind).toBe('sitemapindex');
    expect(result.entries).toHaveLength(1);
  });

  it('reports an empty file', () => {
    expect(codes(parseSitemapXml('', 0))).toContain('sitemap-empty');
  });

  it('reports an HTML page served in place of a sitemap', () => {
    const html = '<!doctype html><html><body>404 Not Found</body></html>';
    const result = parseSitemapXml(html, html.length);
    expect(result.kind).toBe('unknown');
    expect(codes(result)).toContain('sitemap-is-html');
  });

  it('reports a document with no sitemap root', () => {
    const xml = '<?xml version="1.0"?><rss><channel></channel></rss>';
    expect(codes(parseSitemapXml(xml, xml.length))).toContain('sitemap-no-root');
  });

  it('reports a missing namespace', () => {
    const xml = '<?xml version="1.0"?><urlset><url><loc>https://example.com/a</loc></url></urlset>';
    expect(codes(parseSitemapXml(xml, xml.length))).toContain('sitemap-no-namespace');
  });

  it('reports a wrong namespace', () => {
    const xml = urlset('<url><loc>https://example.com/a</loc></url>', 'http://example.com/wrong');
    expect(codes(parseSitemapXml(xml, xml.length))).toContain('sitemap-wrong-namespace');
  });

  it('reports a missing XML declaration', () => {
    const xml = `<urlset xmlns="${SITEMAP_NAMESPACE}"><url><loc>https://example.com/a</loc></url></urlset>`;
    expect(codes(parseSitemapXml(xml, xml.length))).toContain('sitemap-no-declaration');
  });

  it('reports an empty sitemap', () => {
    const xml = urlset('');
    expect(codes(parseSitemapXml(xml, xml.length))).toContain('sitemap-no-entries');
  });
});

describe('parseSitemapXml - entry validation', () => {
  it('flags an unescaped ampersand', () => {
    const xml = urlset('<url><loc>https://example.com/a?x=1&y=2</loc></url>');
    expect(codes(parseSitemapXml(xml, xml.length))).toContain('sitemap-unescaped-ampersand');
  });

  it('accepts a properly escaped ampersand', () => {
    const xml = urlset('<url><loc>https://example.com/a?x=1&amp;y=2</loc></url>');
    const result = parseSitemapXml(xml, xml.length);
    expect(codes(result)).not.toContain('sitemap-unescaped-ampersand');
    expect(result.entries[0]?.loc).toBe('https://example.com/a?x=1&y=2');
  });

  it('flags an entry with no loc', () => {
    const xml = urlset('<url><lastmod>2024-01-01</lastmod></url>');
    expect(codes(parseSitemapXml(xml, xml.length))).toContain('sitemap-entry-no-loc');
  });

  it('flags an invalid lastmod', () => {
    const xml = urlset('<url><loc>https://example.com/a</loc><lastmod>15/01/2024</lastmod></url>');
    expect(codes(parseSitemapXml(xml, xml.length))).toContain('sitemap-bad-lastmod');
  });

  it('accepts ISO 8601 lastmod with a timezone', () => {
    const xml = urlset(
      '<url><loc>https://example.com/a</loc><lastmod>2024-01-15T10:30:00+01:00</lastmod></url>',
    );
    expect(codes(parseSitemapXml(xml, xml.length))).not.toContain('sitemap-bad-lastmod');
  });

  it('flags an out-of-range priority', () => {
    const xml = urlset('<url><loc>https://example.com/a</loc><priority>1.5</priority></url>');
    expect(codes(parseSitemapXml(xml, xml.length))).toContain('sitemap-bad-priority');
  });

  it('flags duplicate URLs', () => {
    const xml = urlset(
      '<url><loc>https://example.com/a</loc></url><url><loc>https://example.com/a</loc></url>',
    );
    expect(codes(parseSitemapXml(xml, xml.length))).toContain('sitemap-duplicates');
  });

  it('flags a loc outside any url element', () => {
    const xml = urlset('<url><loc>https://example.com/a</loc></url><loc>https://example.com/b</loc>');
    expect(codes(parseSitemapXml(xml, xml.length))).toContain('sitemap-orphan-loc');
  });

  it('unwraps CDATA in a loc', () => {
    const xml = urlset('<url><loc><![CDATA[https://example.com/a]]></loc></url>');
    expect(parseSitemapXml(xml, xml.length).entries[0]?.loc).toBe('https://example.com/a');
  });

  it('flags a file over the 50MB limit', () => {
    const xml = urlset('<url><loc>https://example.com/a</loc></url>');
    expect(codes(parseSitemapXml(xml, 60 * 1024 * 1024))).toContain('sitemap-too-large');
  });

  it('never throws on malformed input', () => {
    for (const bad of ['<urlset', '<<<>>>', '\u0000\u0001', '{"json":true}']) {
      expect(() => parseSitemapXml(bad, bad.length)).not.toThrow();
    }
  });
});

describe('decodeXml', () => {
  it('decodes entities without double-decoding', () => {
    expect(decodeXml('a &amp;lt; b')).toBe('a &lt; b');
    expect(decodeXml('&lt;tag&gt;')).toBe('<tag>');
    expect(decodeXml('&#65;&#x42;')).toBe('AB');
  });
});
