export const API_PREFIX = '/api/v1';

export const QUEUE_NAMES = {
  urlValidation: 'url-validation',
  urlProcessing: 'url-processing',
  indexVerification: 'index-verification',
  reportGeneration: 'report-generation',
  maintenance: 'maintenance',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export const ALL_QUEUE_NAMES: QueueName[] = Object.values(QUEUE_NAMES);

/**
 * Deterministic job ids keep retries and duplicate enqueues idempotent.
 *
 * BullMQ rejects custom ids containing ":" (it reserves the colon for its own
 * Redis key namespacing), so every id here uses "-" as the separator.
 */
export const jobIds = {
  validateUrl: (urlId: string): string => `validate-${urlId}`,
  processUrl: (urlId: string, attempt: number): string => `process-${urlId}-${attempt}`,
  verifyUrl: (urlId: string, round: number): string => `verify-${urlId}-${round}`,
  generateReport: (reportId: string): string => `report-${reportId}`,
  maintenance: (task: string): string => `maintenance-${task}`,
  retry: (originalJobId: string, at: number): string => `retry-${originalJobId}-${at}`,
};

export const API_KEY_PREFIX = 'ip_live_';
export const API_KEY_PREFIX_LENGTH = 16;

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 200;
