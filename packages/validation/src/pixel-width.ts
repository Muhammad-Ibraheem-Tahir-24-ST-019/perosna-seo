/**
 * Pixel-width estimation for SERP snippets.
 *
 * Google truncates titles and descriptions by rendered width, not by character
 * count — "Illinois" and "lllllllll" are the same number of characters and
 * nowhere near the same width. Counting characters therefore reports a title as
 * "fine" when it is visibly cut off, which is the single most common mistake in
 * meta-length tooling.
 *
 * We measure with Arial advance widths because that is metrically what Google's
 * desktop SERP renders (Arial on Windows, Helvetica/Liberation Sans elsewhere —
 * all metric-compatible). Widths are in units per 1000 em, so the pixel width of
 * a string is `sum(advance) / 1000 * fontSizePx`.
 */

/** Arial advance widths, units per 1000 em. */
const ARIAL: Record<string, number> = {
  ' ': 278, '!': 278, '"': 355, '#': 556, $: 556, '%': 889, '&': 667, "'": 191,
  '(': 333, ')': 333, '*': 389, '+': 584, ',': 278, '-': 333, '.': 278, '/': 278,
  0: 556, 1: 556, 2: 556, 3: 556, 4: 556, 5: 556, 6: 556, 7: 556, 8: 556, 9: 556,
  ':': 278, ';': 278, '<': 584, '=': 584, '>': 584, '?': 556, '@': 1015,
  A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278,
  J: 500, K: 667, L: 556, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722,
  S: 667, T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
  '[': 278, '\\': 278, ']': 278, '^': 469, _: 556, '`': 333,
  a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222,
  j: 222, k: 500, l: 222, m: 833, n: 556, o: 556, p: 556, q: 556, r: 333,
  s: 500, t: 278, u: 556, v: 500, w: 722, x: 500, y: 500, z: 500,
  '{': 334, '|': 260, '}': 334, '~': 584,
};

/** Latin-1 punctuation and accented letters that appear often in titles. */
const ARIAL_EXTENDED: Record<string, number> = {
  '\u00a0': 278, '\u2018': 222, '\u2019': 222, '\u201c': 333, '\u201d': 333,
  '\u2013': 556, '\u2014': 1000, '\u2026': 1000, '\u2022': 350, '\u00b7': 278,
  '\u00ab': 556, '\u00bb': 556, '\u00a9': 737, '\u00ae': 737, '\u2122': 1000,
  '\u00e9': 556, '\u00e8': 556, '\u00ea': 556, '\u00eb': 556, '\u00e1': 556,
  '\u00e0': 556, '\u00e2': 556, '\u00e4': 556, '\u00e3': 556, '\u00e5': 556,
  '\u00ed': 278, '\u00ec': 278, '\u00ee': 278, '\u00ef': 278,
  '\u00f3': 556, '\u00f2': 556, '\u00f4': 556, '\u00f6': 556, '\u00f5': 556,
  '\u00fa': 556, '\u00f9': 556, '\u00fb': 556, '\u00fc': 556,
  '\u00f1': 556, '\u00e7': 500, '\u00df': 556, '\u00b0': 400, '\u20ac': 556,
  '\u00a3': 556, '\u00a5': 556, '\u2192': 1000, '\u00d7': 584, '\u00f7': 584,
};

/** Fallback for anything outside the tables, by Unicode block. */
function fallbackAdvance(char: string): number {
  const code = char.codePointAt(0) ?? 0;
  // CJK, Hangul, Hiragana/Katakana and fullwidth forms are full-em squares.
  if (
    (code >= 0x1100 && code <= 0x11ff) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xff00 && code <= 0xff60) ||
    code > 0xffff // astral plane: emoji and the like render full width
  ) {
    return 1000;
  }
  // Combining marks add no advance of their own.
  if (code >= 0x0300 && code <= 0x036f) return 0;
  // Zero-width and directionality controls.
  if (code === 0x200b || code === 0x200c || code === 0x200d || code === 0xfeff) return 0;
  return 556; // average lowercase advance
}

function advanceOf(char: string): number {
  return ARIAL[char] ?? ARIAL_EXTENDED[char] ?? fallbackAdvance(char);
}

/** Width of `text` in pixels when rendered in Arial at `fontSizePx`. */
export function measurePixelWidth(text: string, fontSizePx: number): number {
  let units = 0;
  // Iterate by code point so surrogate pairs count once, not twice.
  for (const char of text) units += advanceOf(char);
  return Math.round((units / 1000) * fontSizePx);
}

/**
 * Truncates `text` to fit `maxPx`, appending an ellipsis the way Google does.
 * Returns the original string when it already fits.
 */
export function truncateToPixelWidth(
  text: string,
  maxPx: number,
  fontSizePx: number,
): { text: string; truncated: boolean } {
  if (measurePixelWidth(text, fontSizePx) <= maxPx) return { text, truncated: false };

  const ellipsisPx = measurePixelWidth('\u2026', fontSizePx);
  const budget = maxPx - ellipsisPx;
  let width = 0;
  let out = '';
  for (const char of text) {
    const next = width + (advanceOf(char) / 1000) * fontSizePx;
    if (next > budget) break;
    out += char;
    width = next;
  }
  // Google cuts at a word boundary rather than mid-word where it can.
  const lastSpace = out.lastIndexOf(' ');
  if (lastSpace > out.length * 0.5) out = out.slice(0, lastSpace);
  return { text: `${out.trimEnd()}…`, truncated: true };
}

/**
 * How Google's SERP renders snippets, and where it cuts them off.
 *
 * The pixel ceilings are empirical (measured against live desktop and mobile
 * SERPs) rather than published by Google, so they are stated here as named
 * constants instead of being scattered through the checkers.
 */
export const SERP_METRICS = {
  desktop: {
    title: { fontSizePx: 20, maxPx: 580 },
    description: { fontSizePx: 14, maxPx: 920 },
  },
  mobile: {
    title: { fontSizePx: 16, maxPx: 920 },
    description: { fontSizePx: 14, maxPx: 1180 },
  },
} as const;

export type SerpDevice = keyof typeof SERP_METRICS;
