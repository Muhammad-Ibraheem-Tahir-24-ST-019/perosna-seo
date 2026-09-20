/**
 * The public tool catalogue.
 *
 * One engine backs several routes on purpose. Each route targets a different
 * keyword and therefore needs its own H1, intro and metadata — a page that is
 * genuinely about "robots.txt validator" rather than a copy of the "tester"
 * page. What must NOT differ is the tool itself: every route runs the same
 * engine, so all of them actually work.
 *
 * These entries are the seed and the fallback. Admins can edit them, disable
 * them and add new ones at runtime; the database is authoritative once seeded.
 */

export type ToolEngineKey = 'ROBOTS_TXT' | 'PAGE_META' | 'SITEMAP';

export interface ToolCatalogEntry {
  slug: string;
  name: string;
  engine: ToolEngineKey;
  headline: string;
  intro: string;
  metaTitle: string;
  metaDescription: string;
  listed: boolean;
  sortOrder: number;
}

export const TOOL_CATALOG: ToolCatalogEntry[] = [
  // --- Engine 1a: robots.txt ------------------------------------------------
  {
    slug: 'robots-txt-tester',
    name: 'Robots.txt Tester',
    engine: 'ROBOTS_TXT',
    headline: 'Robots.txt Tester',
    intro:
      'Paste a domain to read its robots.txt, then test any URL path against the rules and see exactly which directive allows or blocks it.',
    metaTitle: 'Robots.txt Tester - Test if a URL is blocked | IndexPilot',
    metaDescription:
      'Free robots.txt tester. Fetch any site’s robots.txt, test a URL path against the rules, and see which directive blocks or allows it.',
    listed: true,
    sortOrder: 10,
  },
  {
    slug: 'robots-txt-checker',
    name: 'Robots.txt Checker',
    engine: 'ROBOTS_TXT',
    headline: 'Robots.txt Checker',
    intro:
      'Check a site’s robots.txt for the mistakes that quietly stop Google crawling: a missing file, a stray Disallow: /, syntax errors and no sitemap directive.',
    metaTitle: 'Robots.txt Checker - Find robots.txt errors | IndexPilot',
    metaDescription:
      'Check any robots.txt for errors. Finds blocked sites, syntax mistakes, missing sitemap directives and typos, with a plain-English fix for each.',
    listed: true,
    sortOrder: 11,
  },
  {
    slug: 'robots-txt-validator',
    name: 'Robots.txt Validator',
    engine: 'ROBOTS_TXT',
    headline: 'Robots.txt Validator',
    intro:
      'Validate robots.txt syntax line by line. Every error and warning is reported with its line number and what to change.',
    metaTitle: 'Robots.txt Validator - Line-by-line syntax check | IndexPilot',
    metaDescription:
      'Validate robots.txt syntax online. Line-by-line errors, warnings and fixes for User-agent, Allow, Disallow, Sitemap and Crawl-delay directives.',
    listed: true,
    sortOrder: 12,
  },

  // --- Engine 1b: page meta -------------------------------------------------
  {
    slug: 'meta-checker',
    name: 'Meta Checker',
    engine: 'PAGE_META',
    headline: 'Meta Tag Checker',
    intro:
      'Check a page’s title, meta description, canonical and robots tags in one pass — measured in pixels, the way Google actually truncates them.',
    metaTitle: 'Meta Tag Checker - Title, description & canonical | IndexPilot',
    metaDescription:
      'Free meta tag checker. Analyse title, meta description, canonical and robots tags for any URL, with pixel widths and a live Google preview.',
    listed: true,
    sortOrder: 20,
  },
  {
    slug: 'meta-title-checker',
    name: 'Meta Title Checker',
    engine: 'PAGE_META',
    headline: 'Meta Title Checker',
    intro:
      'See whether a page’s meta title fits in Google’s results. Measured in pixels rather than characters, because that is what decides truncation.',
    metaTitle: 'Meta Title Checker - Pixel length & SERP preview | IndexPilot',
    metaDescription:
      'Check any page’s meta title length in pixels and characters, see if Google will cut it off, and preview how it appears in search results.',
    listed: true,
    sortOrder: 21,
  },
  {
    slug: 'meta-description-checker',
    name: 'Meta Description Checker',
    engine: 'PAGE_META',
    headline: 'Meta Description Checker',
    intro:
      'Check a page’s meta description length, see whether Google will truncate it, and preview the snippet as it will appear in search.',
    metaTitle: 'Meta Description Checker - Length & preview | IndexPilot',
    metaDescription:
      'Free meta description checker. Measures pixel width and character count, flags missing or truncated descriptions, and previews the Google snippet.',
    listed: true,
    sortOrder: 22,
  },
  {
    slug: 'title-tag-checker',
    name: 'Title Tag Checker',
    engine: 'PAGE_META',
    headline: 'Title Tag Checker',
    intro:
      'Read the <title> tag of any page and check its length, uniqueness signals and how it renders in the search results.',
    metaTitle: 'Title Tag Checker - Check any page’s title tag | IndexPilot',
    metaDescription:
      'Check the title tag of any URL. Reports the exact text, character count, pixel width, truncation risk and a live SERP preview.',
    listed: true,
    sortOrder: 23,
  },
  {
    slug: 'seo-title-checker',
    name: 'SEO Title Checker',
    engine: 'PAGE_META',
    headline: 'SEO Title Checker',
    intro:
      'Check whether a page’s SEO title is the right length, is actually present, and matches what Google will show for it.',
    metaTitle: 'SEO Title Checker - Length, preview & fixes | IndexPilot',
    metaDescription:
      'Analyse any page’s SEO title: pixel width, character count, truncation, missing or duplicate tags, plus a Google results preview.',
    listed: true,
    sortOrder: 24,
  },
  {
    slug: 'canonical-checker',
    name: 'Canonical Tag Checker',
    engine: 'PAGE_META',
    headline: 'Canonical Tag Checker',
    intro:
      'Check a page’s rel="canonical" tag: whether it exists, whether it points at itself, another page, or another domain entirely.',
    metaTitle: 'Canonical Tag Checker - Check rel=canonical | IndexPilot',
    metaDescription:
      'Free canonical tag checker. Finds rel="canonical" on any URL and reports whether it is self-referencing, cross-domain, duplicated or missing.',
    listed: true,
    sortOrder: 25,
  },

  // --- Engine 2: sitemap ----------------------------------------------------
  {
    slug: 'sitemap-checker',
    name: 'Sitemap Checker',
    engine: 'SITEMAP',
    headline: 'XML Sitemap Checker',
    intro:
      'Find a site’s sitemap, validate its XML, and check the URLs inside it for 404s, redirects and robots.txt blocks.',
    metaTitle: 'Sitemap Checker - Validate XML & check every URL | IndexPilot',
    metaDescription:
      'Free sitemap checker. Auto-finds your sitemap, validates the XML structure, and tests the URLs inside it for 404s, redirects and robots blocks.',
    listed: true,
    sortOrder: 30,
  },
  {
    slug: 'sitemap-finder',
    name: 'Sitemap Finder',
    engine: 'SITEMAP',
    headline: 'Sitemap Finder',
    intro:
      'Find the XML sitemap for any domain. Reads the Sitemap directive in robots.txt, then falls back to the conventional paths.',
    metaTitle: 'Sitemap Finder - Find any site’s XML sitemap | IndexPilot',
    metaDescription:
      'Find the XML sitemap for any domain. Checks robots.txt and the common sitemap paths, then validates whatever it finds.',
    listed: true,
    sortOrder: 31,
  },
  {
    slug: 'sitemap-validator',
    name: 'Sitemap Validator',
    engine: 'SITEMAP',
    headline: 'XML Sitemap Validator',
    intro:
      'Validate an XML sitemap against the sitemaps.org protocol: namespace, structure, entry limits, lastmod dates and priority values.',
    metaTitle: 'XML Sitemap Validator - Check sitemap syntax | IndexPilot',
    metaDescription:
      'Validate XML sitemap syntax online. Checks namespace, structure, 50,000-URL and 50MB limits, lastmod format and priority values.',
    listed: true,
    sortOrder: 32,
  },
  {
    slug: 'xml-sitemap-checker',
    name: 'XML Sitemap Checker',
    engine: 'SITEMAP',
    headline: 'XML Sitemap Checker',
    intro:
      'Check an XML sitemap end to end: is it valid XML, is it the right namespace, and do the URLs inside it actually resolve?',
    metaTitle: 'XML Sitemap Checker - Validate & test URLs | IndexPilot',
    metaDescription:
      'Check any XML sitemap. Validates the file against the sitemaps.org spec and tests the URLs it lists for 404s, redirects and robots blocks.',
    listed: true,
    sortOrder: 33,
  },
];

export const TOOL_SLUGS = TOOL_CATALOG.map((tool) => tool.slug);

export function findCatalogEntry(slug: string): ToolCatalogEntry | undefined {
  return TOOL_CATALOG.find((tool) => tool.slug === slug);
}

/** Human label for an engine, used in the admin panel. */
export const TOOL_ENGINE_LABELS: Record<ToolEngineKey, string> = {
  ROBOTS_TXT: 'Robots.txt',
  PAGE_META: 'Page meta',
  SITEMAP: 'Sitemap',
};

// ---------------------------------------------------------------------------
// Wire contract for the public tool endpoints
//
// These mirror what `apps/api` returns. They live here so the browser and the
// server are compiled against one definition rather than two that drift.
// ---------------------------------------------------------------------------

export type ToolVerdict = 'good' | 'warning' | 'problem' | 'missing';
export type IssueSeverity = 'error' | 'warning' | 'info';

export interface ToolSummary {
  slug: string;
  name: string;
  engine: ToolEngineKey;
  headline: string;
  intro: string;
  requiresAuth: boolean;
}

export interface ToolDetail extends ToolSummary {
  metaTitle: string;
  metaDescription: string;
}

export interface ToolRunMeta {
  cached: boolean;
  cacheAgeSeconds: number;
  durationMs: number;
  checkedAt: string;
}

export interface ToolQuota {
  remaining: number;
  limit: number;
  resetSeconds: number;
}

export interface ToolResponse<T> {
  result: T;
  meta: ToolRunMeta;
  quota: ToolQuota;
}

export interface ToolError {
  code: string;
  message: string;
}

// --- Robots -----------------------------------------------------------------

export interface RobotsIssue {
  severity: IssueSeverity;
  code: string;
  message: string;
  line: number | null;
  excerpt: string | null;
}

export interface RobotsPathVerdict {
  path: string;
  userAgent: string;
  allowed: boolean;
  matchedRule: string | null;
  explanation: string;
}

export interface RobotsToolResult {
  input: string;
  robotsUrl: string;
  finalUrl: string;
  status: number;
  exists: boolean;
  content: string | null;
  contentType: string | null;
  audit: {
    issues: RobotsIssue[];
    stats: { lines: number; groups: number; rules: number; sitemaps: number; comments: number };
    blocksEverything: boolean;
  };
  sitemaps: string[];
  groups: { agents: string[]; rules: { type: string; path: string }[] }[];
  tests: RobotsPathVerdict[];
  error: ToolError | null;
}

// --- Page meta --------------------------------------------------------------

export interface MetaFieldReport {
  value: string | null;
  charCount: number;
  pixelWidth: number;
  pixelLimit: number;
  truncated: boolean;
  verdict: ToolVerdict;
  message: string;
  issueCode: string | null;
}

export interface CanonicalReport {
  value: string | null;
  resolved: string | null;
  present: boolean;
  target: 'self' | 'other-page' | 'other-domain' | null;
  duplicateCount: number;
  verdict: ToolVerdict;
  message: string;
  issueCode: string | null;
}

export interface PageMetaReport {
  title: MetaFieldReport;
  description: MetaFieldReport;
  canonical: CanonicalReport;
  headings: { h1: string[]; h2Count: number; verdict: ToolVerdict; message: string; issueCode: string | null };
  social: {
    ogTitle: string | null;
    ogDescription: string | null;
    ogImage: string | null;
    twitterCard: string | null;
  };
  robots: { metaRobots: string | null; noindex: boolean; nofollow: boolean };
  lang: string | null;
  charset: string | null;
  viewport: string | null;
  serpPreview: { title: string; description: string; displayUrl: string };
}

export interface MetaToolResult {
  input: string;
  requestedUrl: string;
  finalUrl: string;
  status: number;
  contentType: string | null;
  redirectCount: number;
  redirectChain: string[];
  xRobotsTag: string | null;
  report: PageMetaReport | null;
  robotsTxtAllowed: boolean | null;
  robotsTxtNote: string | null;
  error: ToolError | null;
}

// --- Sitemap ----------------------------------------------------------------

export type SitemapUrlState =
  | 'ok'
  | 'redirect'
  | 'client-error'
  | 'server-error'
  | 'blocked'
  | 'unreachable';

export interface SitemapUrlCheck {
  url: string;
  status: number | null;
  state: SitemapUrlState;
  finalUrl: string | null;
  note: string | null;
}

export interface SitemapEntry {
  loc: string;
  lastmod: string | null;
  changefreq: string | null;
  priority: string | null;
}

export interface SitemapToolResult {
  input: string;
  discovery: { source: string; url: string; used: boolean }[];
  robotsSitemaps: string[];
  robotsError: string | null;
  sitemapUrl: string | null;
  kind: string;
  totalEntries: number;
  childSitemaps: { url: string; entries: number; error: string | null }[];
  entries: SitemapEntry[];
  issues: { severity: IssueSeverity; code: string; message: string; excerpt: string | null }[];
  checked: SitemapUrlCheck[];
  summary: {
    checkedCount: number;
    okCount: number;
    redirectCount: number;
    brokenCount: number;
    blockedCount: number;
    notCheckedCount: number;
    limit: number;
  };
  error: ToolError | null;
}

// --- Admin ------------------------------------------------------------------

export interface AdminToolInput {
  slug: string;
  name: string;
  engine: ToolEngineKey;
  headline: string;
  intro: string;
  metaTitle: string;
  metaDescription: string;
  enabled?: boolean;
  requiresAuth?: boolean;
  listed?: boolean;
  sortOrder?: number;
}

export interface AdminToolRow extends Required<Omit<AdminToolInput, 'engine'>> {
  id: string;
  engine: ToolEngineKey;
  grants: number;
  runs: number;
  createdAt: string;
  updatedAt: string;
}

export interface ToolAnalytics {
  days: number;
  totals: { runs: number; avgDurationMs: number; signedIn: number; anonymous: number };
  byTool: { slug: string; runs: number; avgDurationMs: number }[];
  byOutcome: Record<string, number>;
  topHosts: { host: string | null; runs: number }[];
}
