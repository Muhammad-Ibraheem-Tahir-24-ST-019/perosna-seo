import { safeFetch, SafeFetchError, type SafeFetchOptions } from './fetcher.js';
import { extractHtmlSignals, isHtmlContentType, parseXRobotsTag } from './html.js';
import { checkRobots } from './robots.js';
import { DEFAULT_SSRF_POLICY, type SsrfPolicy } from './ssrf.js';

export type ValidationVerdict = 'VALID' | 'INVALID' | 'BLOCKED';

export interface UrlValidationOutcome {
  verdict: ValidationVerdict;
  httpStatus: number | null;
  finalUrl: string | null;
  redirectCount: number;
  redirectChain: string[];
  robotsAllowed: boolean | null;
  robotsNote: string | null;
  noindexDetected: boolean | null;
  noindexSource: string | null;
  canonicalUrl: string | null;
  /** True when the canonical points at a different URL than the one submitted. */
  canonicalMismatch: boolean;
  title: string | null;
  contentType: string | null;
  contentLength: number | null;
  contentAccessible: boolean;
  errorCode: string | null;
  errorMessage: string | null;
  peerAddress: string | null;
  durationMs: number;
  /** Non-fatal observations surfaced in the UI. */
  warnings: string[];
}

export interface ValidateUrlOptions extends SafeFetchOptions {
  policy?: SsrfPolicy;
  checkRobotsTxt?: boolean;
  /** When true a noindex directive fails validation instead of warning. */
  treatNoindexAsInvalid?: boolean;
  userAgent?: string;
}

/**
 * Runs the full pre-flight check for one URL.
 *
 * Verdicts:
 *  - BLOCKED  : policy refused the fetch (SSRF) or robots.txt disallows crawling.
 *  - INVALID  : unreachable, HTTP error status, or empty/unusable response.
 *  - VALID    : reachable and crawlable; `warnings` may still carry noindex or
 *               canonical mismatch notes so credits are spent knowingly.
 */
export async function validateUrl(
  url: string,
  options: ValidateUrlOptions = {},
): Promise<UrlValidationOutcome> {
  const startedAt = Date.now();
  const policy = options.policy ?? DEFAULT_SSRF_POLICY;
  const userAgent = options.userAgent ?? 'IndexPilotBot/1.0';
  const fetchOptions: SafeFetchOptions = { ...options, policy, userAgent };

  const outcome: UrlValidationOutcome = {
    verdict: 'INVALID',
    httpStatus: null,
    finalUrl: null,
    redirectCount: 0,
    redirectChain: [],
    robotsAllowed: null,
    robotsNote: null,
    noindexDetected: null,
    noindexSource: null,
    canonicalUrl: null,
    canonicalMismatch: false,
    title: null,
    contentType: null,
    contentLength: null,
    contentAccessible: false,
    errorCode: null,
    errorMessage: null,
    peerAddress: null,
    durationMs: 0,
    warnings: [],
  };

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    outcome.errorCode = 'UNPARSEABLE';
    outcome.errorMessage = 'URL could not be parsed.';
    outcome.durationMs = Date.now() - startedAt;
    return outcome;
  }

  let response;
  try {
    response = await safeFetch(url, fetchOptions);
  } catch (error) {
    const fetchError = error instanceof SafeFetchError ? error : null;
    outcome.errorCode = fetchError?.code ?? 'NETWORK_ERROR';
    outcome.errorMessage = fetchError?.message ?? (error as Error).message;
    outcome.verdict = fetchError?.code === 'SSRF_BLOCKED' ? 'BLOCKED' : 'INVALID';
    outcome.durationMs = Date.now() - startedAt;
    return outcome;
  }

  outcome.httpStatus = response.status;
  outcome.finalUrl = response.finalUrl;
  outcome.redirectCount = response.redirects.length;
  outcome.redirectChain = response.redirects.map((hop) => hop.location);
  outcome.contentType = response.contentType;
  outcome.contentLength = response.contentLength ?? response.bodyBytes;
  outcome.peerAddress = response.peerAddress;

  if (response.redirects.length > 0) {
    outcome.warnings.push(
      `Redirects ${response.redirects.length} time(s) to ${response.finalUrl}. Submit the final URL for best results.`,
    );
  }

  if (response.status >= 400) {
    outcome.errorCode = `HTTP_${response.status}`;
    outcome.errorMessage = `The page returned HTTP ${response.status}.`;
    outcome.verdict = 'INVALID';
    outcome.durationMs = Date.now() - startedAt;
    return outcome;
  }

  outcome.contentAccessible = response.bodyBytes > 0 || response.status === 204;
  if (!outcome.contentAccessible) {
    outcome.warnings.push('The response body was empty.');
  }

  const headerRobots = parseXRobotsTag(response.headers['x-robots-tag']);
  if (isHtmlContentType(response.contentType)) {
    const signals = extractHtmlSignals(response.body, response.finalUrl);
    outcome.noindexDetected = signals.noindex || headerRobots.noindex;
    outcome.noindexSource = signals.noindexSource ?? headerRobots.source;
    outcome.canonicalUrl = signals.canonicalUrl;
    outcome.title = signals.title;
    if (signals.canonicalUrl && !sameUrl(signals.canonicalUrl, response.finalUrl)) {
      outcome.canonicalMismatch = true;
      outcome.warnings.push(
        `Canonical points to ${signals.canonicalUrl}; search engines may index that URL instead.`,
      );
    }
  } else {
    outcome.noindexDetected = headerRobots.noindex;
    outcome.noindexSource = headerRobots.source;
  }

  if (options.checkRobotsTxt !== false) {
    const robots = await checkRobots(parsed, userAgent, fetchOptions);
    outcome.robotsAllowed = robots.allowed;
    outcome.robotsNote = robots.note;
    if (robots.allowed === false) {
      outcome.verdict = 'BLOCKED';
      outcome.errorCode = 'ROBOTS_DISALLOWED';
      outcome.errorMessage = 'robots.txt disallows crawling this path.';
      outcome.durationMs = Date.now() - startedAt;
      return outcome;
    }
    if (robots.allowed === null && robots.note) {
      outcome.warnings.push(`robots.txt could not be evaluated: ${robots.note}`);
    }
  }

  if (outcome.noindexDetected) {
    const message = `Page carries a noindex directive (${outcome.noindexSource ?? 'meta robots'}). Search engines will not index it.`;
    if (options.treatNoindexAsInvalid) {
      outcome.verdict = 'BLOCKED';
      outcome.errorCode = 'NOINDEX';
      outcome.errorMessage = message;
      outcome.durationMs = Date.now() - startedAt;
      return outcome;
    }
    outcome.warnings.push(message);
  }

  outcome.verdict = 'VALID';
  outcome.durationMs = Date.now() - startedAt;
  return outcome;
}

function sameUrl(a: string, b: string): boolean {
  try {
    const left = new URL(a);
    const right = new URL(b);
    left.hash = '';
    right.hash = '';
    return left.toString() === right.toString();
  } catch {
    return a === b;
  }
}
