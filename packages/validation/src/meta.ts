/**
 * Head-tag extraction and grading for the public meta / title / canonical
 * checkers.
 *
 * This reuses the same tolerant regex approach as `html.ts` rather than pulling
 * in a DOM parser: the input is an arbitrary third-party page that may be
 * malformed, truncated by the fetch cap, or not HTML at all, and a parser that
 * throws on bad markup would turn "their page is broken" into "our tool is
 * broken".
 */

import { SERP_METRICS, measurePixelWidth, truncateToPixelWidth } from './pixel-width.js';

export type Verdict = 'good' | 'warning' | 'problem' | 'missing';

export interface FieldReport {
  value: string | null;
  charCount: number;
  /** Pixel width as rendered in Google's desktop SERP. */
  pixelWidth: number;
  pixelLimit: number;
  /** True when the SERP would visibly cut it off. */
  truncated: boolean;
  verdict: Verdict;
  /** Plain-English statement of what is wrong, or why it is fine. */
  message: string;
  /** Stable key so the UI can look up the matching "how to fix" section. */
  issueCode: string | null;
}

export interface CanonicalReport {
  value: string | null;
  /** Resolved absolute form of `value`, when it parses. */
  resolved: string | null;
  present: boolean;
  /** 'self' | 'other-page' | 'other-domain' | null when absent/unparseable. */
  target: 'self' | 'other-page' | 'other-domain' | null;
  /** More than one rel=canonical in the head — Google ignores all of them. */
  duplicateCount: number;
  verdict: Verdict;
  message: string;
  issueCode: string | null;
}

export interface HeadingReport {
  h1: string[];
  h2Count: number;
  verdict: Verdict;
  message: string;
  issueCode: string | null;
}

export interface SocialReport {
  ogTitle: string | null;
  ogDescription: string | null;
  ogImage: string | null;
  twitterCard: string | null;
}

export interface PageMetaReport {
  title: FieldReport;
  description: FieldReport;
  canonical: CanonicalReport;
  headings: HeadingReport;
  social: SocialReport;
  robots: {
    metaRobots: string | null;
    noindex: boolean;
    nofollow: boolean;
  };
  lang: string | null;
  charset: string | null;
  viewport: string | null;
  /** What the desktop SERP would actually display, after truncation. */
  serpPreview: {
    title: string;
    description: string;
    displayUrl: string;
  };
}

const META_TAG_RE = /<meta\b[^>]*>/gi;
const LINK_TAG_RE = /<link\b[^>]*>/gi;
const TITLE_RE = /<title[^>]*>([\s\S]{0,1000}?)<\/title>/i;
const HTML_TAG_RE = /<html\b[^>]*>/i;
const H1_RE = /<h1\b[^>]*>([\s\S]{0,2000}?)<\/h1>/gi;
const H2_RE = /<h2\b[^>]*>/gi;

function attributes(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const attrRe = /([a-zA-Z:_-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let match: RegExpExecArray | null;
  while ((match = attrRe.exec(tag)) !== null) {
    const key = (match[1] ?? '').toLowerCase();
    out[key] = match[3] ?? match[4] ?? match[5] ?? '';
  }
  return out;
}

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0',
  mdash: '\u2014', ndash: '\u2013', hellip: '\u2026', rsquo: '\u2019',
  lsquo: '\u2018', ldquo: '\u201c', rdquo: '\u201d', trade: '\u2122',
  copy: '\u00a9', reg: '\u00ae', eacute: '\u00e9', egrave: '\u00e8',
};

export function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      const code = Number.parseInt(body.slice(2), 16);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : whole;
    }
    if (body.startsWith('#')) {
      const code = Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/** Collapses runs of whitespace, the way a browser renders inline text. */
function collapse(value: string): string {
  return decodeEntities(value.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function headOf(html: string): string {
  const end = html.search(/<\/head>/i);
  return end === -1 ? html.slice(0, 250_000) : html.slice(0, end);
}

// --- Grading --------------------------------------------------------------
//
// Character thresholds are the conventional SEO guidance; the pixel check is
// what actually decides "truncated". Both are reported so the user sees why.

function gradeTitle(value: string | null): FieldReport {
  const { fontSizePx, maxPx } = SERP_METRICS.desktop.title;
  const base = {
    value,
    charCount: value?.length ?? 0,
    pixelWidth: value ? measurePixelWidth(value, fontSizePx) : 0,
    pixelLimit: maxPx,
  };

  if (value === null) {
    return {
      ...base,
      truncated: false,
      verdict: 'missing',
      message: 'This page has no <title> tag. Google will invent one from the page content.',
      issueCode: 'title-missing',
    };
  }
  if (value.trim() === '') {
    return {
      ...base,
      truncated: false,
      verdict: 'problem',
      message: 'The <title> tag is present but empty.',
      issueCode: 'title-empty',
    };
  }

  const truncated = base.pixelWidth > maxPx;
  if (truncated) {
    return {
      ...base,
      truncated,
      verdict: 'problem',
      message: `At ${base.pixelWidth}px this title is wider than the ${maxPx}px Google shows, so the end is cut off.`,
      issueCode: 'title-too-long',
    };
  }
  if (base.charCount < 30) {
    return {
      ...base,
      truncated,
      verdict: 'warning',
      message: `Only ${base.charCount} characters. There is room for more — you are giving up space you could use to rank.`,
      issueCode: 'title-too-short',
    };
  }
  if (base.pixelWidth > maxPx * 0.95) {
    return {
      ...base,
      truncated,
      verdict: 'warning',
      message: `At ${base.pixelWidth}px this is within ${maxPx - base.pixelWidth}px of being cut off. Any wording change could push it over.`,
      issueCode: 'title-near-limit',
    };
  }
  return {
    ...base,
    truncated,
    verdict: 'good',
    message: `${base.charCount} characters, ${base.pixelWidth}px — fits comfortably in the ${maxPx}px Google displays.`,
    issueCode: null,
  };
}

function gradeDescription(value: string | null): FieldReport {
  const { fontSizePx, maxPx } = SERP_METRICS.desktop.description;
  const base = {
    value,
    charCount: value?.length ?? 0,
    pixelWidth: value ? measurePixelWidth(value, fontSizePx) : 0,
    pixelLimit: maxPx,
  };

  if (value === null) {
    return {
      ...base,
      truncated: false,
      verdict: 'missing',
      message:
        'No meta description. Google will pull a snippet from the page body instead, and you do not get to choose which part.',
      issueCode: 'description-missing',
    };
  }
  if (value.trim() === '') {
    return {
      ...base,
      truncated: false,
      verdict: 'problem',
      message: 'The meta description is present but empty.',
      issueCode: 'description-empty',
    };
  }

  const truncated = base.pixelWidth > maxPx;
  if (truncated) {
    return {
      ...base,
      truncated,
      verdict: 'warning',
      message: `At ${base.pixelWidth}px this is wider than the ${maxPx}px Google shows, so the end is cut off.`,
      issueCode: 'description-too-long',
    };
  }
  if (base.charCount < 70) {
    return {
      ...base,
      truncated,
      verdict: 'warning',
      message: `Only ${base.charCount} characters. Short descriptions leave SERP space unused and read as thin.`,
      issueCode: 'description-too-short',
    };
  }
  return {
    ...base,
    truncated,
    verdict: 'good',
    message: `${base.charCount} characters, ${base.pixelWidth}px — fits in the ${maxPx}px Google displays.`,
    issueCode: null,
  };
}

function gradeCanonical(
  hrefs: string[],
  pageUrl: string,
): CanonicalReport {
  const first = hrefs[0] ?? null;
  if (first === null) {
    return {
      value: null,
      resolved: null,
      present: false,
      target: null,
      duplicateCount: 0,
      verdict: 'missing',
      message:
        'No rel="canonical" link. Google will pick a canonical itself, which may not be the URL you want ranking.',
      issueCode: 'canonical-missing',
    };
  }

  let resolved: string | null = null;
  try {
    resolved = new URL(first, pageUrl).toString();
  } catch {
    return {
      value: first,
      resolved: null,
      present: true,
      target: null,
      duplicateCount: hrefs.length,
      verdict: 'problem',
      message: `The canonical value "${first}" is not a valid URL, so it will be ignored.`,
      issueCode: 'canonical-invalid',
    };
  }

  if (hrefs.length > 1) {
    return {
      value: first,
      resolved,
      present: true,
      target: null,
      duplicateCount: hrefs.length,
      verdict: 'problem',
      message: `${hrefs.length} rel="canonical" tags were found. Google ignores all of them when there is more than one.`,
      issueCode: 'canonical-duplicate',
    };
  }

  let target: CanonicalReport['target'];
  let verdict: Verdict;
  let message: string;
  let issueCode: string | null;

  const page = safeUrl(pageUrl);
  const canon = safeUrl(resolved);
  const sameHost = page && canon && page.host === canon.host;
  const samePage =
    page && canon && page.host === canon.host && stripTrailingSlash(page.pathname) === stripTrailingSlash(canon.pathname) && page.search === canon.search;

  if (samePage) {
    target = 'self';
    verdict = 'good';
    message = 'The canonical points at this page — this is the normal, correct setup.';
    issueCode = null;
  } else if (sameHost) {
    target = 'other-page';
    verdict = 'warning';
    message = `This page tells Google to rank a different URL on the same site (${resolved}). That is correct for duplicates, and a ranking bug if it is not intentional.`;
    issueCode = 'canonical-other-page';
  } else {
    target = 'other-domain';
    verdict = 'problem';
    message = `The canonical points to a different domain (${resolved}). Unless this is deliberate syndication, this page is handing its ranking to another site.`;
    issueCode = 'canonical-other-domain';
  }

  return { value: first, resolved, present: true, target, duplicateCount: 1, verdict, message, issueCode };
}

function stripTrailingSlash(path: string): string {
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
}

function safeUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function gradeHeadings(h1: string[], h2Count: number): HeadingReport {
  if (h1.length === 0) {
    return {
      h1,
      h2Count,
      verdict: 'missing',
      message: 'No <h1> on the page. The h1 is the strongest on-page signal of what the page is about.',
      issueCode: 'h1-missing',
    };
  }
  if (h1.length > 1) {
    return {
      h1,
      h2Count,
      verdict: 'warning',
      message: `${h1.length} <h1> tags. Not a penalty, but it dilutes the topic signal — one h1 per page is the safe default.`,
      issueCode: 'h1-multiple',
    };
  }
  return { h1, h2Count, verdict: 'good', message: 'Exactly one <h1>.', issueCode: null };
}

// --- Entry point ----------------------------------------------------------

/**
 * Parses the head of an HTML document and grades every SERP-facing field.
 *
 * `pageUrl` must be the URL the HTML was actually served from (after redirects),
 * because canonical resolution and the self-reference check both depend on it.
 */
export function analysePageMeta(html: string, pageUrl: string): PageMetaReport {
  const head = headOf(html);

  let title: string | null = null;
  const titleMatch = TITLE_RE.exec(head);
  if (titleMatch) title = collapse(titleMatch[1] ?? '');

  let description: string | null = null;
  let metaRobots: string | null = null;
  let charset: string | null = null;
  let viewport: string | null = null;
  const social: SocialReport = {
    ogTitle: null,
    ogDescription: null,
    ogImage: null,
    twitterCard: null,
  };

  for (const tag of head.match(META_TAG_RE) ?? []) {
    const attrs = attributes(tag);
    if (attrs['charset'] !== undefined) charset = attrs['charset'];
    const name = (attrs['name'] ?? '').toLowerCase();
    const property = (attrs['property'] ?? '').toLowerCase();
    const content = attrs['content'];
    if (content === undefined) continue;

    // First wins: a duplicated meta description is a real-world quirk and
    // Google reads the first one.
    if (name === 'description' && description === null) description = collapse(content);
    if (name === 'robots' && metaRobots === null) metaRobots = content;
    if (name === 'viewport') viewport = content;
    if (property === 'og:title' && social.ogTitle === null) social.ogTitle = collapse(content);
    if (property === 'og:description' && social.ogDescription === null) {
      social.ogDescription = collapse(content);
    }
    if (property === 'og:image' && social.ogImage === null) social.ogImage = content;
    if ((name === 'twitter:card' || property === 'twitter:card') && social.twitterCard === null) {
      social.twitterCard = content;
    }
  }

  const canonicalHrefs: string[] = [];
  for (const tag of head.match(LINK_TAG_RE) ?? []) {
    const attrs = attributes(tag);
    const rel = (attrs['rel'] ?? '').toLowerCase().split(/\s+/);
    if (rel.includes('canonical') && attrs['href']) canonicalHrefs.push(attrs['href'].trim());
  }

  const h1: string[] = [];
  let h1Match: RegExpExecArray | null;
  H1_RE.lastIndex = 0;
  while ((h1Match = H1_RE.exec(html)) !== null && h1.length < 20) {
    h1.push(collapse(h1Match[1] ?? ''));
  }
  H2_RE.lastIndex = 0;
  const h2Count = (html.match(H2_RE) ?? []).length;

  let lang: string | null = null;
  const htmlTag = HTML_TAG_RE.exec(html);
  if (htmlTag) lang = attributes(htmlTag[0])['lang'] ?? null;

  const robotsDirectives = (metaRobots ?? '').toLowerCase().split(',').map((part) => part.trim());

  const titleReport = gradeTitle(title);
  const descriptionReport = gradeDescription(description);

  return {
    title: titleReport,
    description: descriptionReport,
    canonical: gradeCanonical(canonicalHrefs, pageUrl),
    headings: gradeHeadings(h1, h2Count),
    social,
    robots: {
      metaRobots,
      noindex: robotsDirectives.includes('noindex') || robotsDirectives.includes('none'),
      nofollow: robotsDirectives.includes('nofollow') || robotsDirectives.includes('none'),
    },
    lang,
    charset,
    viewport,
    serpPreview: {
      title: truncateToPixelWidth(
        title || 'Untitled page',
        SERP_METRICS.desktop.title.maxPx,
        SERP_METRICS.desktop.title.fontSizePx,
      ).text,
      description: truncateToPixelWidth(
        description || 'No meta description — Google will generate a snippet from the page.',
        SERP_METRICS.desktop.description.maxPx,
        SERP_METRICS.desktop.description.fontSizePx,
      ).text,
      displayUrl: toDisplayUrl(pageUrl),
    },
  };
}

/** Renders a URL the way the SERP does: host, then breadcrumb-style path. */
export function toDisplayUrl(value: string): string {
  const url = safeUrl(value);
  if (!url) return value;
  const segments = url.pathname.split('/').filter(Boolean);
  const host = url.host.replace(/^www\./, '');
  return segments.length === 0 ? host : `${host} › ${segments.join(' \u203a ')}`;
}
