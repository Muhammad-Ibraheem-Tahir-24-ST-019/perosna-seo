import {
  isNormalizeFailure,
  normalizeUrl,
  type NormalizeFailure,
  type NormalizedUrl,
} from './normalize.js';

export interface ParsedSubmission {
  /** Deduplicated, normalized, submittable URLs. */
  accepted: NormalizedUrl[];
  /** Rejected lines with the reason, capped by `maxInvalidSamples`. */
  invalid: NormalizeFailure[];
  invalidCount: number;
  /** Lines that were exact duplicates of another line in the same payload. */
  duplicatesInPayload: number;
  receivedCount: number;
  /** True when input exceeded `maxUrls` and the tail was dropped. */
  truncated: boolean;
}

export interface ParseOptions {
  maxUrls: number;
  maxInvalidSamples?: number;
}

/** Splits a pasted blob on newlines/commas/whitespace-separated URL boundaries. */
export function splitRawInput(text: string): string[] {
  return text
    .split(/[\r\n]+/)
    .flatMap((line) => {
      const trimmed = line.trim();
      if (!trimmed) return [];
      // A single line can legitimately hold several space or comma separated URLs.
      if (/\s/.test(trimmed) || trimmed.includes(',')) {
        const parts = trimmed.split(/[\s,]+/).filter(Boolean);
        if (parts.length > 1 && parts.every((part) => /^(https?:\/\/|www\.|[a-z0-9-]+\.)/i.test(part))) {
          return parts;
        }
      }
      return [trimmed];
    })
    .filter(Boolean);
}

export function parseSubmissionText(text: string, options: ParseOptions): ParsedSubmission {
  return parseSubmissionLines(splitRawInput(text), options);
}

export function parseSubmissionLines(lines: string[], options: ParseOptions): ParsedSubmission {
  const maxInvalidSamples = options.maxInvalidSamples ?? 25;
  const accepted: NormalizedUrl[] = [];
  const invalid: NormalizeFailure[] = [];
  const seen = new Set<string>();

  let invalidCount = 0;
  let duplicatesInPayload = 0;
  let truncated = false;

  for (const line of lines) {
    if (accepted.length >= options.maxUrls) {
      truncated = true;
      break;
    }
    const result = normalizeUrl(line);
    if (isNormalizeFailure(result)) {
      if (result.reason === 'EMPTY') continue;
      invalidCount += 1;
      if (invalid.length < maxInvalidSamples) invalid.push(result);
      continue;
    }
    if (seen.has(result.normalizedUrlHash)) {
      duplicatesInPayload += 1;
      continue;
    }
    seen.add(result.normalizedUrlHash);
    accepted.push(result);
  }

  return {
    accepted,
    invalid,
    invalidCount,
    duplicatesInPayload,
    receivedCount: lines.length,
    truncated,
  };
}

/** RFC4180-style CSV reader that tolerates semicolons and tab separators. */
export function parseCsv(content: string): string[][] {
  const delimiter = detectDelimiter(content);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < content.length; i += 1) {
    const char = content[i] as string;
    if (inQuotes) {
      if (char === '"') {
        if (content[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      continue;
    }
    if (char === delimiter) {
      row.push(field);
      field = '';
      continue;
    }
    if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      continue;
    }
    if (char === '\r') continue;
    field += char;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((entry) => entry.some((cell) => cell.trim().length > 0));
}

function detectDelimiter(content: string): string {
  const sample = content.slice(0, 5000);
  const counts: Array<[string, number]> = [
    [',', (sample.match(/,/g) ?? []).length],
    [';', (sample.match(/;/g) ?? []).length],
    ['\t', (sample.match(/\t/g) ?? []).length],
  ];
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0]?.[1] ? (counts[0][0] as string) : ',';
}

export interface CsvUrlExtraction {
  urls: string[];
  /** Zero-based index of the column the URLs were taken from. */
  columnIndex: number;
  headers: string[] | null;
  /** True when a header row was detected and skipped. */
  hadHeader: boolean;
}

const URLISH = /^(https?:\/\/|www\.)|^[a-z0-9-]+(\.[a-z0-9-]+)+\//i;

/**
 * Picks the column that most looks like URLs. Callers may override with
 * `columnIndex` when the guess is ambiguous.
 */
export function extractUrlsFromCsv(content: string, columnIndex?: number): CsvUrlExtraction {
  const rows = parseCsv(content);
  if (rows.length === 0) {
    return { urls: [], columnIndex: 0, headers: null, hadHeader: false };
  }

  const firstRow = rows[0] as string[];
  // A first row is a header when it holds no URLs but a later row does. Header
  // names are not required: "a,b" over a column of URLs is still a header.
  const headerLooksLikeHeader =
    rows.length > 1 &&
    firstRow.every((cell) => !URLISH.test(cell.trim())) &&
    rows.slice(1, 50).some((row) => row.some((cell) => URLISH.test(cell.trim())));
  const headers = headerLooksLikeHeader ? firstRow.map((cell) => cell.trim()) : null;
  const dataRows = headerLooksLikeHeader ? rows.slice(1) : rows;

  let chosen = columnIndex;
  if (chosen === undefined && headers) {
    const named = headers.findIndex((header) => /^(url|link|page|address|loc)s?$/i.test(header));
    if (named >= 0) chosen = named;
  }
  if (chosen === undefined) {
    const width = Math.max(...rows.map((entry) => entry.length));
    let bestScore = -1;
    let bestIndex = 0;
    for (let col = 0; col < width; col += 1) {
      let score = 0;
      for (const entry of dataRows.slice(0, 200)) {
        const cell = (entry[col] ?? '').trim();
        if (URLISH.test(cell)) score += 1;
      }
      if (score > bestScore) {
        bestScore = score;
        bestIndex = col;
      }
    }
    chosen = bestIndex;
  }

  const urls = dataRows
    .map((entry) => (entry[chosen as number] ?? '').trim())
    .filter((cell) => cell.length > 0);

  return { urls, columnIndex: chosen, headers, hadHeader: headerLooksLikeHeader };
}

/** Entry point used by the upload endpoint: picks a parser by file name/content. */
export function parseUploadedFile(
  filename: string,
  content: string,
  options: ParseOptions & { columnIndex?: number },
): ParsedSubmission & { source: 'csv' | 'txt'; csv?: CsvUrlExtraction } {
  const looksCsv =
    /\.(csv|tsv)$/i.test(filename) ||
    (content.includes(',') && content.split(/\r?\n/, 5).every((line) => line.includes(',')));

  if (looksCsv) {
    const csv = extractUrlsFromCsv(content, options.columnIndex);
    return { ...parseSubmissionLines(csv.urls, options), source: 'csv', csv };
  }
  return { ...parseSubmissionText(content, options), source: 'txt' };
}
