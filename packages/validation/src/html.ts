export interface HtmlSignals {
  /** True when a meta robots / X-Robots-Tag noindex directive was found. */
  noindex: boolean;
  nofollow: boolean;
  canonicalUrl: string | null;
  title: string | null;
  /** Raw directive text that produced the noindex verdict. */
  noindexSource: string | null;
}

const META_TAG_RE = /<meta\b[^>]*>/gi;
const LINK_TAG_RE = /<link\b[^>]*>/gi;
const TITLE_RE = /<title[^>]*>([\s\S]{0,300}?)<\/title>/i;

/** Robots directives that apply to Google/Bing crawlers or to all crawlers. */
const RELEVANT_ROBOT_AGENTS = new Set(['robots', 'googlebot', 'bingbot', 'googlebot-news']);

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

/**
 * Extracts indexability signals from an HTML document.
 *
 * The body may be truncated by the fetch cap; head elements appear early so the
 * cap rarely matters, and a missing signal is reported as "not detected" rather
 * than guessed.
 */
export function extractHtmlSignals(html: string, baseUrl: string): HtmlSignals {
  const signals: HtmlSignals = {
    noindex: false,
    nofollow: false,
    canonicalUrl: null,
    title: null,
    noindexSource: null,
  };
  if (!html) return signals;

  // Only the head region matters and it keeps the regex work bounded.
  const headEnd = html.search(/<\/head>/i);
  const head = headEnd === -1 ? html.slice(0, 200_000) : html.slice(0, headEnd);

  for (const tag of head.match(META_TAG_RE) ?? []) {
    const attrs = attributes(tag);
    const name = (attrs['name'] ?? attrs['property'] ?? '').toLowerCase();
    if (!RELEVANT_ROBOT_AGENTS.has(name)) continue;
    const content = (attrs['content'] ?? '').toLowerCase();
    const directives = content.split(',').map((item) => item.trim());
    if (directives.includes('noindex') || directives.includes('none')) {
      signals.noindex = true;
      signals.noindexSource = `meta name="${name}" content="${attrs['content'] ?? ''}"`;
    }
    if (directives.includes('nofollow') || directives.includes('none')) {
      signals.nofollow = true;
    }
  }

  for (const tag of head.match(LINK_TAG_RE) ?? []) {
    const attrs = attributes(tag);
    if ((attrs['rel'] ?? '').toLowerCase().split(/\s+/).includes('canonical')) {
      const href = attrs['href'];
      if (href) {
        try {
          signals.canonicalUrl = new URL(href, baseUrl).toString();
        } catch {
          signals.canonicalUrl = href;
        }
      }
      break;
    }
  }

  const titleMatch = TITLE_RE.exec(head);
  if (titleMatch?.[1]) {
    signals.title = decodeEntities(titleMatch[1].trim()).slice(0, 200);
  }

  return signals;
}

/** Parses an X-Robots-Tag response header (may carry several directives). */
export function parseXRobotsTag(headerValue: string | null | undefined): {
  noindex: boolean;
  source: string | null;
} {
  if (!headerValue) return { noindex: false, source: null };
  const value = headerValue.toLowerCase();
  for (const part of value.split(',')) {
    const directive = part.includes(':') ? (part.split(':').pop() ?? '') : part;
    const token = directive.trim();
    if (token === 'noindex' || token === 'none') {
      return { noindex: true, source: `X-Robots-Tag: ${headerValue}` };
    }
  }
  return { noindex: false, source: null };
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

export function isHtmlContentType(contentType: string | null): boolean {
  if (!contentType) return false;
  const value = contentType.toLowerCase();
  return value.includes('text/html') || value.includes('application/xhtml+xml');
}
