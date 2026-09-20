import { describe, expect, it } from 'vitest';
import {
  hashNormalizedUrl,
  isNormalizeFailure,
  normalizeUrl,
} from '../../packages/validation/src/normalize.js';
import {
  extractUrlsFromCsv,
  parseCsv,
  parseSubmissionText,
  parseUploadedFile,
  splitRawInput,
} from '../../packages/validation/src/parse-input.js';

describe('normalizeUrl', () => {
  it('keeps query parameters intact', () => {
    const result = normalizeUrl('https://example.com/page?utm_source=x&id=7');
    expect(isNormalizeFailure(result)).toBe(false);
    if (isNormalizeFailure(result)) return;
    expect(result.normalizedUrl).toBe('https://example.com/page?utm_source=x&id=7');
  });

  it('drops the fragment, default port and trailing host dot', () => {
    const result = normalizeUrl('https://Example.com.:443/Path#section');
    if (isNormalizeFailure(result)) throw new Error(result.message);
    expect(result.normalizedUrl).toBe('https://example.com/Path');
    expect(result.hostname).toBe('example.com');
    expect(result.path).toBe('/Path');
  });

  it('preserves path case because servers may be case sensitive', () => {
    const result = normalizeUrl('https://example.com/Case/Sensitive');
    if (isNormalizeFailure(result)) throw new Error(result.message);
    expect(result.normalizedUrl).toContain('/Case/Sensitive');
  });

  it('assumes https for scheme-less input', () => {
    const result = normalizeUrl('example.com/blog');
    if (isNormalizeFailure(result)) throw new Error(result.message);
    expect(result.scheme).toBe('https');
  });

  it('strips wrappers and trailing punctuation', () => {
    const result = normalizeUrl('<https://example.com/a>,');
    if (isNormalizeFailure(result)) throw new Error(result.message);
    expect(result.normalizedUrl).toBe('https://example.com/a');
  });

  const rejected: Array<[string, string]> = [
    ['javascript:alert(1)', 'UNSUPPORTED_SCHEME'],
    ['file:///etc/passwd', 'UNSUPPORTED_SCHEME'],
    ['data:text/html,<h1>x', 'UNSUPPORTED_SCHEME'],
    ['ftp://example.com/file', 'UNSUPPORTED_SCHEME'],
    ['https://user:pass@example.com/', 'CREDENTIALS_IN_URL'],
    ['not a url at all', 'UNPARSEABLE'],
    ['', 'EMPTY'],
  ];

  for (const [input, reason] of rejected) {
    it(`rejects ${JSON.stringify(input)} with ${reason}`, () => {
      const result = normalizeUrl(input);
      expect(isNormalizeFailure(result)).toBe(true);
      if (isNormalizeFailure(result)) expect(result.reason).toBe(reason);
    });
  }

  it('rejects URLs longer than the limit', () => {
    const result = normalizeUrl(`https://example.com/${'a'.repeat(3000)}`);
    expect(isNormalizeFailure(result) && result.reason).toBe('TOO_LONG');
  });

  it('produces a stable hash for equivalent inputs', () => {
    const a = normalizeUrl('https://example.com/page#one');
    const b = normalizeUrl('HTTPS://Example.com/page');
    if (isNormalizeFailure(a) || isNormalizeFailure(b)) throw new Error('unexpected failure');
    expect(a.normalizedUrlHash).toBe(b.normalizedUrlHash);
    expect(a.normalizedUrlHash).toBe(hashNormalizedUrl('https://example.com/page'));
  });

  it('treats trailing-slash variants as distinct (conservative)', () => {
    const a = normalizeUrl('https://example.com/dir');
    const b = normalizeUrl('https://example.com/dir/');
    if (isNormalizeFailure(a) || isNormalizeFailure(b)) throw new Error('unexpected failure');
    expect(a.normalizedUrlHash).not.toBe(b.normalizedUrlHash);
  });
});

describe('bulk input parsing', () => {
  it('splits on newlines and drops blanks', () => {
    expect(splitRawInput('a.com\n\n  b.com  \n')).toEqual(['a.com', 'b.com']);
  });

  it('deduplicates inside one payload and reports counts', () => {
    const parsed = parseSubmissionText(
      [
        'https://example.com/a',
        'https://example.com/a#dup',
        'https://example.com/b',
        'javascript:alert(1)',
        '',
      ].join('\n'),
      { maxUrls: 100 },
    );
    expect(parsed.accepted).toHaveLength(2);
    expect(parsed.duplicatesInPayload).toBe(1);
    expect(parsed.invalidCount).toBe(1);
    expect(parsed.invalid[0]?.reason).toBe('UNSUPPORTED_SCHEME');
  });

  it('truncates at the configured maximum', () => {
    const lines = Array.from({ length: 50 }, (_, i) => `https://example.com/${i}`).join('\n');
    const parsed = parseSubmissionText(lines, { maxUrls: 10 });
    expect(parsed.accepted).toHaveLength(10);
    expect(parsed.truncated).toBe(true);
  });
});

describe('CSV parsing', () => {
  it('handles quoted fields and embedded commas', () => {
    const rows = parseCsv('url,note\n"https://example.com/a,b","hello, world"\n');
    expect(rows[1]).toEqual(['https://example.com/a,b', 'hello, world']);
  });

  it('detects the URL column from the header', () => {
    const csv = 'name,url,score\nAlpha,https://example.com/a,5\nBeta,https://example.com/b,7\n';
    const extraction = extractUrlsFromCsv(csv);
    expect(extraction.hadHeader).toBe(true);
    expect(extraction.columnIndex).toBe(1);
    expect(extraction.urls).toEqual(['https://example.com/a', 'https://example.com/b']);
  });

  it('detects the URL column by content when there is no header', () => {
    const csv = 'Alpha,https://example.com/a,5\nBeta,https://example.com/b,7\n';
    const extraction = extractUrlsFromCsv(csv);
    expect(extraction.columnIndex).toBe(1);
    expect(extraction.urls).toHaveLength(2);
  });

  it('honours an explicit column override', () => {
    const csv = 'a,b\nhttps://example.com/1,https://example.com/2\n';
    expect(extractUrlsFromCsv(csv, 1).urls).toEqual(['https://example.com/2']);
  });

  it('routes .txt uploads through the line parser', () => {
    const parsed = parseUploadedFile(
      'urls.txt',
      'https://example.com/a\nhttps://example.com/b',
      { maxUrls: 100 },
    );
    expect(parsed.source).toBe('txt');
    expect(parsed.accepted).toHaveLength(2);
  });

  it('routes .csv uploads through the CSV parser', () => {
    const parsed = parseUploadedFile(
      'urls.csv',
      'url,label\nhttps://example.com/a,one\nhttps://example.com/b,two\n',
      { maxUrls: 100 },
    );
    expect(parsed.source).toBe('csv');
    expect(parsed.accepted).toHaveLength(2);
  });
});
