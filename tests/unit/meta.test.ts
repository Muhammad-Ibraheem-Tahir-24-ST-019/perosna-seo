import { describe, expect, it } from 'vitest';
import { analysePageMeta, toDisplayUrl } from '../../packages/validation/src/meta.js';

const PAGE = 'https://example.com/blog/post';

function page(head: string, body = ''): string {
  return `<!doctype html><html lang="en"><head>${head}</head><body>${body}</body></html>`;
}

describe('analysePageMeta - title', () => {
  it('reports a missing title', () => {
    const report = analysePageMeta(page(''), PAGE);
    expect(report.title.verdict).toBe('missing');
    expect(report.title.issueCode).toBe('title-missing');
    expect(report.title.value).toBeNull();
  });

  it('reports an empty title as a problem, not as missing', () => {
    const report = analysePageMeta(page('<title></title>'), PAGE);
    expect(report.title.verdict).toBe('problem');
    expect(report.title.issueCode).toBe('title-empty');
  });

  it('accepts a well-sized title', () => {
    const title = 'How to fix robots.txt errors on a large site';
    const report = analysePageMeta(page(`<title>${title}</title>`), PAGE);
    expect(report.title.value).toBe(title);
    expect(report.title.verdict).toBe('good');
    expect(report.title.truncated).toBe(false);
  });

  it('flags a title that exceeds the pixel budget', () => {
    const title = 'Wonderful Wide Words '.repeat(6);
    const report = analysePageMeta(page(`<title>${title}</title>`), PAGE);
    expect(report.title.verdict).toBe('problem');
    expect(report.title.issueCode).toBe('title-too-long');
    expect(report.title.truncated).toBe(true);
    expect(report.title.pixelWidth).toBeGreaterThan(report.title.pixelLimit);
  });

  it('flags a title that is too short', () => {
    const report = analysePageMeta(page('<title>SEO</title>'), PAGE);
    expect(report.title.verdict).toBe('warning');
    expect(report.title.issueCode).toBe('title-too-short');
  });

  it('decodes entities and collapses whitespace', () => {
    const report = analysePageMeta(
      page('<title>Tips &amp; tricks   for\n  crawling</title>'),
      PAGE,
    );
    expect(report.title.value).toBe('Tips & tricks for crawling');
  });

  it('decodes numeric entities', () => {
    const report = analysePageMeta(page('<title>Caf&#233; &#x2014; guide</title>'), PAGE);
    expect(report.title.value).toBe('Café — guide');
  });
});

describe('analysePageMeta - description', () => {
  it('reports a missing description', () => {
    const report = analysePageMeta(page('<title>Some title here for you</title>'), PAGE);
    expect(report.description.verdict).toBe('missing');
    expect(report.description.issueCode).toBe('description-missing');
  });

  it('accepts a well-sized description', () => {
    const description =
      'A practical walkthrough of the robots.txt mistakes that quietly stop Google from crawling your most important pages, and how to fix each one.';
    const report = analysePageMeta(
      page(`<meta name="description" content="${description}">`),
      PAGE,
    );
    expect(report.description.verdict).toBe('good');
    expect(report.description.value).toBe(description);
  });

  it('takes the first of duplicated descriptions, as Google does', () => {
    const report = analysePageMeta(
      page('<meta name="description" content="first"><meta name="description" content="second">'),
      PAGE,
    );
    expect(report.description.value).toBe('first');
  });

  it('flags a short description', () => {
    const report = analysePageMeta(page('<meta name="description" content="Too short.">'), PAGE);
    expect(report.description.verdict).toBe('warning');
    expect(report.description.issueCode).toBe('description-too-short');
  });
});

describe('analysePageMeta - canonical', () => {
  it('reports a missing canonical', () => {
    const report = analysePageMeta(page(''), PAGE);
    expect(report.canonical.present).toBe(false);
    expect(report.canonical.verdict).toBe('missing');
  });

  it('recognises a self-referencing canonical', () => {
    const report = analysePageMeta(page(`<link rel="canonical" href="${PAGE}">`), PAGE);
    expect(report.canonical.target).toBe('self');
    expect(report.canonical.verdict).toBe('good');
  });

  it('treats a trailing slash as the same page', () => {
    const report = analysePageMeta(page(`<link rel="canonical" href="${PAGE}/">`), PAGE);
    expect(report.canonical.target).toBe('self');
  });

  it('resolves a relative canonical against the page URL', () => {
    const report = analysePageMeta(page('<link rel="canonical" href="/blog/post">'), PAGE);
    expect(report.canonical.resolved).toBe(PAGE);
    expect(report.canonical.target).toBe('self');
  });

  it('flags a canonical pointing at another page on the same host', () => {
    const report = analysePageMeta(
      page('<link rel="canonical" href="https://example.com/other">'),
      PAGE,
    );
    expect(report.canonical.target).toBe('other-page');
    expect(report.canonical.verdict).toBe('warning');
  });

  it('flags a cross-domain canonical as a problem', () => {
    const report = analysePageMeta(
      page('<link rel="canonical" href="https://competitor.com/page">'),
      PAGE,
    );
    expect(report.canonical.target).toBe('other-domain');
    expect(report.canonical.verdict).toBe('problem');
  });

  it('flags duplicate canonical tags', () => {
    const report = analysePageMeta(
      page(
        `<link rel="canonical" href="${PAGE}"><link rel="canonical" href="https://example.com/other">`,
      ),
      PAGE,
    );
    expect(report.canonical.duplicateCount).toBe(2);
    expect(report.canonical.issueCode).toBe('canonical-duplicate');
  });

  it('handles rel with several tokens', () => {
    const report = analysePageMeta(page(`<link rel="Canonical Self" href="${PAGE}">`), PAGE);
    expect(report.canonical.present).toBe(true);
  });
});

describe('analysePageMeta - other signals', () => {
  it('extracts robots directives', () => {
    const report = analysePageMeta(page('<meta name="robots" content="noindex, nofollow">'), PAGE);
    expect(report.robots.noindex).toBe(true);
    expect(report.robots.nofollow).toBe(true);
  });

  it('treats "none" as both noindex and nofollow', () => {
    const report = analysePageMeta(page('<meta name="robots" content="none">'), PAGE);
    expect(report.robots.noindex).toBe(true);
    expect(report.robots.nofollow).toBe(true);
  });

  it('counts headings', () => {
    const report = analysePageMeta(page('', '<h1>One</h1><h2>a</h2><h2>b</h2>'), PAGE);
    expect(report.headings.h1).toEqual(['One']);
    expect(report.headings.h2Count).toBe(2);
    expect(report.headings.verdict).toBe('good');
  });

  it('flags multiple h1 tags', () => {
    const report = analysePageMeta(page('', '<h1>One</h1><h1>Two</h1>'), PAGE);
    expect(report.headings.verdict).toBe('warning');
    expect(report.headings.issueCode).toBe('h1-multiple');
  });

  it('strips inline markup from headings', () => {
    const report = analysePageMeta(page('', '<h1>Hello <span>there</span></h1>'), PAGE);
    expect(report.headings.h1[0]).toBe('Hello there');
  });

  it('extracts Open Graph and language', () => {
    const report = analysePageMeta(
      page('<meta property="og:title" content="OG title"><meta name="viewport" content="width=device-width">'),
      PAGE,
    );
    expect(report.social.ogTitle).toBe('OG title');
    expect(report.lang).toBe('en');
    expect(report.viewport).toBe('width=device-width');
  });

  it('does not crash on malformed markup', () => {
    expect(() => analysePageMeta('<html><head><title>Broken', PAGE)).not.toThrow();
    expect(() => analysePageMeta('', PAGE)).not.toThrow();
    expect(() => analysePageMeta('not html at all', PAGE)).not.toThrow();
  });
});

describe('serp preview', () => {
  it('truncates the preview the way the SERP would', () => {
    const title = 'Wonderful Wide Words '.repeat(6);
    const report = analysePageMeta(page(`<title>${title}</title>`), PAGE);
    expect(report.serpPreview.title.endsWith('…')).toBe(true);
    expect(report.serpPreview.title.length).toBeLessThan(title.length);
  });

  it('renders the display URL as a breadcrumb', () => {
    expect(toDisplayUrl('https://www.example.com/blog/post')).toBe(
      'example.com › blog › post',
    );
    expect(toDisplayUrl('https://example.com/')).toBe('example.com');
  });
});
