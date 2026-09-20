/**
 * "How to fix it" copy, keyed by the issue codes the engines emit.
 *
 * The build brief asks for this explicitly: a bare technical output ("blocked",
 * "too long") is what every other free tool gives you. What makes a page worth
 * ranking — and worth linking to — is telling someone what to actually change.
 *
 * Keys here must match the `issueCode` / `code` values produced in
 * `packages/validation`. An unknown code renders nothing rather than a
 * placeholder, so a new check never ships a half-written explanation.
 */

export interface FixGuide {
  title: string;
  /** What the finding means, in one or two sentences. */
  what: string;
  /** The concrete change to make. */
  fix: string;
  /** Optional copy-pasteable example. */
  example?: string;
}

export const FIX_GUIDES: Record<string, FixGuide> = {
  // --- robots.txt ----------------------------------------------------------
  'robots-blocks-all': {
    title: 'Your robots.txt blocks the entire site',
    what: 'A `Disallow: /` rule in the group that applies to Googlebot tells every crawler to stay off every URL. This is the single most damaging robots.txt mistake, and it is usually left behind after a staging deploy.',
    fix: 'Remove the `Disallow: /` line, or narrow it to the paths you actually want kept out. If you want everything crawlable, an empty Disallow value is the explicit way to say so.',
    example: 'User-agent: *\nDisallow:\n\nSitemap: https://example.com/sitemap.xml',
  },
  'robots-empty': {
    title: 'The file is empty',
    what: 'An empty robots.txt is valid and means "crawl everything". That may be exactly right, but an empty file is far more often a build that wrote the file without its contents.',
    fix: 'If you meant to allow everything, add an explicit group and a sitemap reference so the intent is visible to the next person who reads it.',
    example: 'User-agent: *\nDisallow:\n\nSitemap: https://example.com/sitemap.xml',
  },
  'robots-is-html': {
    title: 'An HTML page is being served instead of robots.txt',
    what: 'The response is a web page, not a text file. Crawlers cannot parse it, so none of your rules apply. This normally means the server has no robots.txt and is returning a soft 404 — a "not found" page with a 200 status.',
    fix: 'Serve a real text file at /robots.txt with the content type text/plain. If the file genuinely does not exist, return a 404 rather than an HTML page.',
  },
  'robots-no-sitemap': {
    title: 'No Sitemap directive',
    what: 'Your robots.txt does not tell crawlers where your sitemap is. This is not an error, but it is the cheapest discovery win available — every major crawler reads it.',
    fix: 'Add a Sitemap line with the absolute URL. It can appear anywhere in the file and applies to all crawlers, regardless of which group it sits in.',
    example: 'Sitemap: https://example.com/sitemap.xml',
  },
  'robots-typo': {
    title: 'A directive is misspelled',
    what: 'Crawlers ignore any line whose field name they do not recognise. They do not warn you and they do not guess — a misspelled `Disallow` simply does nothing, so a rule you believe is protecting a path is not.',
    fix: 'Correct the spelling to the exact directive name. The valid fields are User-agent, Allow, Disallow, Sitemap and Crawl-delay.',
  },
  'robots-missing-colon': {
    title: 'A line has no colon',
    what: 'Every robots.txt directive is `Field: value`. A line without a colon is not a directive and is skipped in full.',
    fix: 'Add the colon. `Disallow /admin` must be `Disallow: /admin`.',
  },
  'robots-path-no-slash': {
    title: 'A path does not start with a slash',
    what: 'Allow and Disallow values are matched against the URL path, which always begins with `/`. A value without one can never match anything.',
    fix: 'Add the leading slash: `Disallow: admin` becomes `Disallow: /admin`.',
  },
  'robots-path-is-url': {
    title: 'A full URL is used where a path is expected',
    what: 'Allow and Disallow take a path, not an absolute URL. Only the Sitemap directive takes a full URL.',
    fix: 'Strip the scheme and host: `Disallow: https://example.com/admin` becomes `Disallow: /admin`.',
  },
  'robots-sitemap-relative': {
    title: 'The Sitemap directive is not an absolute URL',
    what: 'Unlike Allow and Disallow, the Sitemap directive requires a full absolute URL including the scheme and host. A relative path is ignored.',
    fix: 'Write the complete URL.',
    example: 'Sitemap: https://example.com/sitemap.xml',
  },
  'robots-rules-before-agent': {
    title: 'Rules appear before any User-agent line',
    what: 'Allow and Disallow rules only exist inside a group, and a group starts with a User-agent line. Rules written before the first User-agent belong to no group and are discarded.',
    fix: 'Move the rules below a User-agent line.',
    example: 'User-agent: *\nDisallow: /admin',
  },
  'robots-no-agent': {
    title: 'No User-agent line',
    what: 'Without a User-agent line there are no groups, so none of the Allow or Disallow rules in the file apply to any crawler.',
    fix: 'Add `User-agent: *` above your rules to address every crawler.',
  },
  'robots-duplicate-agent': {
    title: 'The same user-agent appears in several groups',
    what: 'When a crawler finds more than one group for itself, it uses one of them — not the union. Rules in the other groups are silently dropped.',
    fix: 'Merge the duplicate groups into one so every rule for that agent sits together.',
  },
  'robots-bom': {
    title: 'The file starts with a byte-order mark',
    what: 'A UTF-8 BOM is three invisible bytes at the start of the file. Some parsers read them as part of the first field name, which breaks the first directive.',
    fix: 'Re-save the file as UTF-8 without a BOM. Most editors offer this as an encoding option.',
  },
  'robots-unknown-field': {
    title: 'An unrecognised directive',
    what: 'The field name is not part of the robots.txt standard, so crawlers skip the line entirely.',
    fix: 'Remove it, or replace it with the directive you meant. Crawl rate for Googlebot is set in Search Console, not in robots.txt.',
  },
  'robots-crawl-delay-ignored': {
    title: 'Crawl-delay does nothing for Googlebot',
    what: 'Google does not support Crawl-delay. Bing and Yandex do honour it, so it is not useless — it just does not do what most people add it for.',
    fix: 'Leave it if you care about Bing or Yandex. To slow Googlebot down, use the crawl rate setting in Search Console instead.',
  },

  // --- Titles --------------------------------------------------------------
  'title-missing': {
    title: 'The page has no title tag',
    what: 'Without a <title>, Google generates one from the page content — usually the h1 or anchor text pointing at the page. You lose control of the single most visible line in the search result.',
    fix: 'Add a <title> inside <head>. Put the distinctive part first, since the end is what gets cut off.',
    example: '<title>Robots.txt Tester - Check if a URL is blocked</title>',
  },
  'title-empty': {
    title: 'The title tag is empty',
    what: 'The tag exists but has no text, which is treated the same as having no title at all.',
    fix: 'Write the title text between the tags. This is usually a template that received an empty variable.',
  },
  'title-too-long': {
    title: 'The title is wider than Google displays',
    what: 'Google truncates titles by rendered pixel width, not character count. Anything past roughly 580px is replaced with an ellipsis, so the end of your title never reaches the reader.',
    fix: 'Move the important words to the front and cut the tail. Brand suffixes are the usual thing to shorten or drop — they are the least useful part of the line.',
  },
  'title-near-limit': {
    title: 'The title is close to being cut off',
    what: 'It fits today, but there is very little room left. A single word change, or a wider font on a different platform, will push it over.',
    fix: 'Trim a few characters to leave headroom, especially if the last words carry meaning.',
  },
  'title-too-short': {
    title: 'The title is very short',
    what: 'A short title is not an error, but it leaves visible space unused and often means the page is not describing itself fully.',
    fix: 'Add the qualifier a searcher would actually type — the location, the format, the year, the specific problem being solved.',
  },

  // --- Descriptions --------------------------------------------------------
  'description-missing': {
    title: 'No meta description',
    what: 'Google will write a snippet itself, pulled from wherever on the page seems to match the query. It is often a reasonable snippet — but it is not the one you chose.',
    fix: 'Add a meta description in <head> that makes the case for clicking, written for a person rather than for a keyword count.',
    example: '<meta name="description" content="Free robots.txt tester. Test any URL path against a site’s rules and see exactly which directive blocks it.">',
  },
  'description-empty': {
    title: 'The meta description is empty',
    what: 'The tag is present with no content, which has the same effect as omitting it.',
    fix: 'Fill in the content attribute, or remove the tag so it is clear the omission is deliberate.',
  },
  'description-too-long': {
    title: 'The description will be truncated',
    what: 'Past roughly 920px of rendered width the snippet is cut off. Everything after the cut is invisible in the result.',
    fix: 'Put the reason to click in the first sentence, and treat anything after that as a bonus that may never be seen.',
  },
  'description-too-short': {
    title: 'The description is very short',
    what: 'A one-line description leaves most of the snippet space unused, and gives Google little to match against a query.',
    fix: 'Expand to roughly 120-155 characters, covering what the page is and who it is for.',
  },

  // --- Canonical -----------------------------------------------------------
  'canonical-missing': {
    title: 'No canonical tag',
    what: 'Google picks a canonical for every page whether you specify one or not. Without the tag, that choice is made for you — and on sites with query parameters or duplicate paths, it is often the wrong URL.',
    fix: 'Add a self-referencing canonical to every indexable page. It is the cheapest insurance against duplicate-content ambiguity.',
    example: '<link rel="canonical" href="https://example.com/blog/post">',
  },
  'canonical-duplicate': {
    title: 'More than one canonical tag',
    what: 'When a page declares several canonicals, Google treats the signal as unreliable and ignores all of them. This usually happens when a CMS and a plugin both add one.',
    fix: 'Leave exactly one. Check for a theme and an SEO plugin both injecting a tag into the head.',
  },
  'canonical-other-domain': {
    title: 'The canonical points at a different domain',
    what: 'This page is telling Google that the canonical version lives on another site, so the other site is the one that should rank. That is correct for syndicated content and a serious bug otherwise.',
    fix: 'If this is your page, point the canonical at itself. Cross-domain canonicals should only be used when you deliberately want the other URL to rank instead.',
  },
  'canonical-other-page': {
    title: 'The canonical points at a different page',
    what: 'This page is consolidated into another URL on the same site. That is the right setup for filtered, paginated or duplicated pages — and wrong if this page is meant to rank on its own.',
    fix: 'If this page should rank, change the canonical to point at itself.',
  },
  'canonical-invalid': {
    title: 'The canonical value is not a valid URL',
    what: 'A canonical that cannot be parsed is ignored, which leaves the page in the same position as having no canonical at all.',
    fix: 'Use an absolute URL including the scheme. Relative values work but are a common source of mistakes when templates change.',
  },

  // --- Headings ------------------------------------------------------------
  'h1-missing': {
    title: 'The page has no h1',
    what: 'The h1 is the clearest statement of what a page is about, for both readers and crawlers. Its absence usually means the heading is being styled with a div.',
    fix: 'Give the page one h1 containing its actual subject.',
  },
  'h1-multiple': {
    title: 'Several h1 tags',
    what: 'HTML5 permits multiple h1s and Google does not penalise them, but several competing top-level headings dilute what the page is about.',
    fix: 'Keep one h1 for the page subject and demote the rest to h2.',
  },

  // --- Sitemaps ------------------------------------------------------------
  'sitemap-is-html': {
    title: 'An HTML page is being served instead of XML',
    what: 'The URL returns a web page rather than a sitemap. Almost always this means the sitemap does not exist and the server is returning its 404 page with a 200 status.',
    fix: 'Confirm the sitemap URL, and make sure missing files return a real 404 rather than a page.',
  },
  'sitemap-no-namespace': {
    title: 'The sitemap has no XML namespace',
    what: 'The urlset element must declare the sitemaps.org namespace. Without it the file is not a valid sitemap and search engines reject it outright.',
    fix: 'Add the xmlns attribute to the root element.',
    example: '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  },
  'sitemap-wrong-namespace': {
    title: 'The XML namespace is wrong',
    what: 'The namespace must be exactly the sitemaps.org schema URL. A typo, or an http/https mismatch, invalidates the whole file.',
    fix: 'Set it to the exact string below — it is an identifier, not a link, so it does not change to https.',
    example: '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  },
  'sitemap-unescaped-ampersand': {
    title: 'An unescaped ampersand',
    what: 'A raw & is not legal in XML. One of them makes the entire document invalid, so every URL in the sitemap is lost, not just the offending line.',
    fix: 'Escape it as &amp;. This is the most common sitemap syntax error and it comes from URLs with query strings being written out unescaped.',
    example: '<loc>https://example.com/search?a=1&amp;b=2</loc>',
  },
  'sitemap-bad-lastmod': {
    title: 'An invalid lastmod date',
    what: 'lastmod must be a W3C datetime. Anything else is ignored, so you lose the freshness signal the field exists to provide.',
    fix: 'Use YYYY-MM-DD, or a full ISO 8601 timestamp with a timezone.',
    example: '<lastmod>2024-01-15</lastmod>',
  },
  'sitemap-bad-priority': {
    title: 'A priority value out of range',
    what: 'priority must be between 0.0 and 1.0. Values outside that range are invalid. Worth knowing: Google ignores priority entirely.',
    fix: 'Correct the value, or drop the field — it has no effect on Google.',
  },
  'sitemap-entry-no-loc': {
    title: 'An entry with no loc element',
    what: 'Every <url> must contain exactly one <loc>. An entry without one describes nothing and is skipped.',
    fix: 'Add the missing <loc>, or remove the empty entry.',
  },
  'sitemap-orphan-loc': {
    title: 'A loc element outside any url element',
    what: 'Each <loc> must be wrapped in a <url> (or <sitemap>, in an index). A bare <loc> is not read.',
    fix: 'Wrap it properly.',
    example: '<url>\n  <loc>https://example.com/page</loc>\n</url>',
  },
  'sitemap-duplicates': {
    title: 'Duplicate URLs in the sitemap',
    what: 'Duplicates waste crawl budget and usually mean the sitemap is generated from a query that is not deduplicated.',
    fix: 'De-duplicate at generation time. Pay attention to URLs that differ only by trailing slash or query parameter.',
  },
  'sitemap-too-many-urls': {
    title: 'Over the 50,000 URL limit',
    what: 'A single sitemap may contain at most 50,000 URLs and be at most 50MB uncompressed. Past that, it is rejected.',
    fix: 'Split it into several sitemaps and list them in a sitemap index file.',
    example:
      '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <sitemap><loc>https://example.com/sitemap-1.xml</loc></sitemap>\n  <sitemap><loc>https://example.com/sitemap-2.xml</loc></sitemap>\n</sitemapindex>',
  },
  'sitemap-too-large': {
    title: 'Over the 50MB limit',
    what: 'The uncompressed file exceeds the size limit and will be rejected regardless of how many URLs it contains.',
    fix: 'Split it across several sitemaps behind an index.',
  },
  'sitemap-content-type': {
    title: 'Served with the wrong content type',
    what: 'Sitemaps should be served as application/xml or text/xml. Some crawlers skip files served as text/html or octet-stream.',
    fix: 'Set the content type on the server or CDN for the sitemap path.',
  },
  'sitemap-no-entries': {
    title: 'The sitemap is valid but empty',
    what: 'The XML parses but contains no URLs, so it gives crawlers nothing to work with.',
    fix: 'Check the generator. An empty sitemap usually means the query behind it returned no rows.',
  },
  'sitemap-no-declaration': {
    title: 'Missing XML declaration',
    what: 'The spec requires the XML declaration on the first line. Most parsers cope without it, so this rarely breaks anything in practice.',
    fix: 'Add it as the very first line, with nothing before it — not even a blank line.',
    example: '<?xml version="1.0" encoding="UTF-8"?>',
  },
  'sitemap-no-root': {
    title: 'Not a sitemap',
    what: 'The document has no <urlset> or <sitemapindex> root, so whatever it is, it is not a sitemap.',
    fix: 'Check the URL. RSS feeds and plain XML files are often mistaken for sitemaps.',
  },
  'sitemap-empty': {
    title: 'The file is empty',
    what: 'The URL returned no content at all.',
    fix: 'Check that the sitemap is actually being generated and deployed.',
  },
};

export function getFixGuide(code: string | null | undefined): FixGuide | null {
  if (!code) return null;
  return FIX_GUIDES[code] ?? null;
}

/** Collects the unique guides for a set of issue codes, preserving order. */
export function collectFixGuides(codes: (string | null | undefined)[]): FixGuide[] {
  const seen = new Set<string>();
  const guides: FixGuide[] = [];
  for (const code of codes) {
    if (!code || seen.has(code)) continue;
    const guide = FIX_GUIDES[code];
    if (!guide) continue;
    seen.add(code);
    guides.push(guide);
  }
  return guides;
}
