import { describe, expect, it } from 'vitest';
import {
  SERP_METRICS,
  measurePixelWidth,
  truncateToPixelWidth,
} from '../../packages/validation/src/pixel-width.js';

describe('measurePixelWidth', () => {
  it('returns zero for an empty string', () => {
    expect(measurePixelWidth('', 20)).toBe(0);
  });

  it('scales linearly with font size', () => {
    const at10 = measurePixelWidth('Hello world', 10);
    const at20 = measurePixelWidth('Hello world', 20);
    // Both results are rounded to whole pixels, so allow one pixel of drift.
    expect(Math.abs(at20 - at10 * 2)).toBeLessThanOrEqual(1);
  });

  it('distinguishes narrow from wide characters of equal length', () => {
    // The whole reason this module exists: character counts lie.
    const narrow = measurePixelWidth('lllllllll', 20);
    const wide = measurePixelWidth('WWWWWWWWW', 20);
    expect('lllllllll'.length).toBe('WWWWWWWWW'.length);
    expect(wide).toBeGreaterThan(narrow * 3);
  });

  it('measures a known string against hand-computed Arial metrics', () => {
    // "Hi" = H(722) + i(222) = 944 units -> 944/1000 * 20px = 18.88 -> 19
    expect(measurePixelWidth('Hi', 20)).toBe(19);
  });

  it('counts astral-plane characters once, not twice', () => {
    const emoji = '\u{1F600}';
    expect(emoji.length).toBe(2); // two UTF-16 code units
    expect(measurePixelWidth(emoji, 20)).toBe(20); // one full-em glyph
  });

  it('gives combining marks no advance of their own', () => {
    const composed = 'é'; // e + combining acute
    expect(measurePixelWidth(composed, 20)).toBe(measurePixelWidth('e', 20));
  });

  it('treats CJK as full-width', () => {
    expect(measurePixelWidth('中', 20)).toBe(20);
  });
});

describe('truncateToPixelWidth', () => {
  const { maxPx, fontSizePx } = {
    maxPx: SERP_METRICS.desktop.title.maxPx,
    fontSizePx: SERP_METRICS.desktop.title.fontSizePx,
  };

  it('leaves a string that already fits untouched', () => {
    const short = 'A short title';
    const result = truncateToPixelWidth(short, maxPx, fontSizePx);
    expect(result).toEqual({ text: short, truncated: false });
  });

  it('truncates an over-long string and marks it', () => {
    const long = 'Very long title '.repeat(20);
    const result = truncateToPixelWidth(long, maxPx, fontSizePx);
    expect(result.truncated).toBe(true);
    expect(result.text.endsWith('…')).toBe(true);
  });

  it('keeps the truncated result within the pixel budget', () => {
    const long = 'The quick brown fox jumps over the lazy dog '.repeat(5);
    const result = truncateToPixelWidth(long, maxPx, fontSizePx);
    expect(measurePixelWidth(result.text, fontSizePx)).toBeLessThanOrEqual(maxPx);
  });

  it('cuts at a word boundary rather than mid-word', () => {
    const long = 'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike';
    const result = truncateToPixelWidth(long, 200, 20);
    const kept = result.text.replace(/…$/, '');
    // Whatever survived must be a whole-word prefix of the original.
    expect(long.startsWith(kept)).toBe(true);
    const nextChar = long.charAt(kept.length);
    expect(nextChar === '' || nextChar === ' ').toBe(true);
  });
});
