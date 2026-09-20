import type { ToolEngineKey } from '@indexpilot/shared/client';

/**
 * Below-the-fold explainer copy.
 *
 * The brief asks for a short explainer under each tool — two or three
 * paragraphs, not an essay, because this audience came for the tool. It also
 * mitigates the thin-content risk of running several keyword pages off one
 * engine: each page carries real prose about the specific thing it checks.
 *
 * Copy is keyed by engine with per-slug overrides, so a new landing page for an
 * existing engine gets sensible content immediately and can be specialised
 * later.
 */

export interface Explainer {
  heading: string;
  paragraphs: string[];
  faqs: { question: string; answer: string }[];
}

const ENGINE_EXPLAINERS: Record<ToolEngineKey, Explainer> = {
  ROBOTS_TXT: {
    heading: 'What robots.txt actually controls',
    paragraphs: [
      'robots.txt is a plain text file at the root of a domain that tells crawlers which paths they may request. It is a crawling instruction, not a security control and not an indexing control: anyone can read the file, and a URL that is disallowed can still appear in search results if other pages link to it. If you need a page kept out of the index, use a noindex directive on a page crawlers are allowed to fetch — blocking it in robots.txt actually prevents Google from seeing the noindex.',
      'Rules are grouped by User-agent. A crawler reads only the group that matches it most specifically, and ignores the rest — so a Googlebot group completely replaces the wildcard group rather than adding to it. Within the matching group, the longest matching rule wins, and Allow beats Disallow when two rules are the same length. That combination is where most robots.txt surprises come from, which is why this tool names the exact rule that decided each verdict rather than just saying "blocked".',
      'The most expensive mistake in this file is a single character: a Disallow: / left behind after a staging deploy takes an entire site out of search. It is worth checking after every release that touches infrastructure, and worth checking on any site you have just taken over.',
    ],
    faqs: [
      {
        question: 'Does robots.txt stop a page being indexed?',
        answer:
          'No. It stops the page being crawled. A blocked URL can still be indexed from external links, usually with no description. To keep a page out of the index, allow crawling and serve a noindex directive.',
      },
      {
        question: 'Where does robots.txt have to live?',
        answer:
          'At the root of the host: https://example.com/robots.txt. A file at any other path is ignored, and each subdomain needs its own.',
      },
      {
        question: 'Does Google support Crawl-delay?',
        answer:
          'No. Bing and Yandex honour it; Google ignores it. Crawl rate for Googlebot is adjusted in Search Console.',
      },
      {
        question: 'Do I need a robots.txt at all?',
        answer:
          'No. A missing file means "crawl everything", which is a perfectly valid setup. Adding one is still worthwhile so you can point crawlers at your sitemap.',
      },
    ],
  },

  PAGE_META: {
    heading: 'Why title and description length is measured in pixels',
    paragraphs: [
      'Google does not truncate titles at a character count — it truncates them at a rendered width, roughly 580 pixels on desktop. This matters more than it sounds: "Illinois Insurance" and "lllllllll lllllllll" are the same number of characters and nowhere near the same width. A character-counting tool will call a title fine while the search result visibly cuts it off, which is why this checker measures the actual rendered width using the font metrics Google renders with.',
      'The meta description works the same way, at roughly 920 pixels. Unlike the title, Google frequently rewrites descriptions to match the query — a well-written description is a strong suggestion rather than a guarantee. It is still worth writing: when Google does use it, it is the only part of the result you control completely, and a page with no description hands that choice away entirely.',
      'The canonical tag is the third piece of the same puzzle. It tells Google which URL should represent a group of near-identical pages. Google treats it as a hint rather than a command, but a self-referencing canonical on every indexable page is cheap insurance against the wrong URL ranking, and a canonical pointing somewhere unexpected is one of the most common causes of "my page disappeared from search".',
    ],
    faqs: [
      {
        question: 'How long should a title tag be?',
        answer:
          'Aim to stay under about 580 pixels, which is roughly 50-60 characters for typical English text. Put the distinctive words first, because the end is what gets cut.',
      },
      {
        question: 'Will Google use my meta description?',
        answer:
          'Sometimes. Google rewrites descriptions when it thinks a different snippet matches the query better. Writing one still helps: it is used often enough to matter, and without one you have no say at all.',
      },
      {
        question: 'Should every page have a canonical tag?',
        answer:
          'Every indexable page should have one pointing at itself. It costs nothing and it removes the ambiguity that duplicate URLs, tracking parameters and pagination otherwise create.',
      },
      {
        question: 'Why does the preview differ from what I see in Google?',
        answer:
          'Google rewrites titles and descriptions for a meaningful share of results, based on the query. This preview shows what your tags say; Google decides what to display.',
      },
    ],
  },

  SITEMAP: {
    heading: 'What an XML sitemap is for',
    paragraphs: [
      'A sitemap is a list of the URLs you want search engines to know about. It does not guarantee crawling or indexing — it is a discovery aid, and its biggest value is on large sites, new sites with few external links, and sites where pages are not well connected by internal linking. Listing a URL in a sitemap is a suggestion; the crawler still decides.',
      'Because it is XML, a sitemap is unforgiving in a way HTML is not. A single unescaped ampersand makes the whole document invalid, and one invalid document loses every URL in it, not just the offending line. The same goes for the namespace: it must be exactly the sitemaps.org schema string, or the file is rejected outright. Those two mistakes account for the large majority of sitemaps that silently do nothing.',
      'The other common failure is subtler: a valid sitemap full of URLs that 404, redirect, or are blocked by robots.txt. That is a sitemap actively wasting crawl budget and sending a signal that the site is poorly maintained. This tool checks the URLs inside the sitemap as well as the file itself, respecting the target site’s own robots.txt as it goes and capping how many URLs it will request in one run.',
    ],
    faqs: [
      {
        question: 'Where should my sitemap live?',
        answer:
          'Anywhere on the same host, though /sitemap.xml is the convention. What matters more is referencing it from robots.txt and submitting it in Search Console.',
      },
      {
        question: 'How many URLs can one sitemap hold?',
        answer:
          '50,000 URLs and 50MB uncompressed. Past either limit, split it into several sitemaps and list those in a sitemap index file.',
      },
      {
        question: 'Do priority and changefreq do anything?',
        answer:
          'Google ignores both. lastmod is used, but only when it is accurate — a site that stamps every URL with today’s date teaches Google to ignore the field entirely.',
      },
      {
        question: 'Should a sitemap include redirects or noindex pages?',
        answer:
          'No. A sitemap should list canonical, indexable, 200-status URLs only. Anything else sends a mixed signal about which pages you actually want ranked.',
      },
    ],
  },
};

/** Per-slug overrides, where a keyword deserves its own angle. */
const SLUG_EXPLAINERS: Partial<Record<string, Partial<Explainer>>> = {
  'robots-txt-validator': {
    heading: 'What makes a robots.txt file invalid',
    paragraphs: [
      'robots.txt has no schema and no compiler, so nothing tells you when a line is wrong — crawlers simply skip whatever they do not understand and carry on. A misspelled Disallow does not raise an error; it just silently stops protecting the path you thought it protected. That is what makes validating this file worth doing deliberately rather than by eye.',
      'The checks that matter most are structural. Rules must sit inside a group that starts with a User-agent line, or they belong to nothing. Paths must begin with a slash, because they are matched against the URL path. The Sitemap directive is the one exception that takes a full absolute URL. And a UTF-8 byte-order mark at the start of the file can swallow the first directive in some parsers.',
      'This validator reports every issue with its line number and the text that triggered it, so you can fix the file rather than guess at it.',
    ],
  },
  'canonical-checker': {
    heading: 'What the canonical tag does',
    paragraphs: [
      'A rel="canonical" link tells search engines which URL is the preferred version of a page when several URLs serve similar content. Tracking parameters, session IDs, pagination, print views and http/https or www/non-www variants all create duplicates, and without a canonical the search engine picks a winner on its own.',
      'Google treats the canonical as a strong hint rather than an instruction. It can and does override it when the signals disagree — for example when your internal links, sitemap and canonical all point at different URLs. Consistency across those three is what makes the canonical stick.',
      'The dangerous cases are the ones this checker calls out specifically: a canonical pointing at another domain (which hands your ranking to that site), and more than one canonical tag on a page (which makes Google ignore all of them). Both are usually the result of two systems — a theme and an SEO plugin, say — each adding a tag without knowing about the other.',
    ],
  },
  'sitemap-finder': {
    heading: 'How sitemaps are discovered',
    paragraphs: [
      'There is no registry of sitemaps. Search engines find them in one of three ways: a Sitemap directive in robots.txt, a submission in Search Console or Bing Webmaster Tools, or a guess at a conventional path such as /sitemap.xml. The first is the only one that works automatically for every crawler, which is why leaving it out is a missed opportunity on almost every site.',
      'This finder follows the same order a crawler would. It reads robots.txt first and uses whatever is declared there, and only falls back to conventional paths when robots.txt names nothing. Whatever it finds is then validated, so you learn both where the sitemap is and whether it is actually usable.',
      'If a sitemap index turns up rather than a plain sitemap, that is normal on larger sites: the index is a list of sitemaps, and the tool opens the first few to reach the URLs inside.',
    ],
  },
};

export function getExplainer(engine: ToolEngineKey, slug: string): Explainer {
  const base = ENGINE_EXPLAINERS[engine];
  const override = SLUG_EXPLAINERS[slug];
  if (!override) return base;
  return {
    heading: override.heading ?? base.heading,
    paragraphs: override.paragraphs ?? base.paragraphs,
    faqs: override.faqs ?? base.faqs,
  };
}
