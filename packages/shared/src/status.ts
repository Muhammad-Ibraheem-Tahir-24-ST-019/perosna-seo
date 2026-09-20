/**
 * URL state is tracked on three independent dimensions. A single overloaded enum
 * loses information (e.g. "processed but index not yet verified"), so the
 * user-facing label is *derived* from the three stored dimensions.
 */
export const ValidationStatus = {
  RECEIVED: 'RECEIVED',
  VALIDATING: 'VALIDATING',
  VALID: 'VALID',
  INVALID: 'INVALID',
  BLOCKED: 'BLOCKED',
} as const;
export type ValidationStatus = (typeof ValidationStatus)[keyof typeof ValidationStatus];

export const ProcessingStatus = {
  NOT_QUEUED: 'NOT_QUEUED',
  QUEUED: 'QUEUED',
  PROCESSING: 'PROCESSING',
  DISCOVERY_ATTEMPTED: 'DISCOVERY_ATTEMPTED',
  CRAWL_DETECTED: 'CRAWL_DETECTED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
} as const;
export type ProcessingStatus = (typeof ProcessingStatus)[keyof typeof ProcessingStatus];

export const VerificationStatus = {
  NOT_CHECKED: 'NOT_CHECKED',
  PENDING: 'PENDING',
  INDEXED_CONFIRMED: 'INDEXED_CONFIRMED',
  NOT_CONFIRMED_INDEXED: 'NOT_CONFIRMED_INDEXED',
  ERROR: 'ERROR',
} as const;
export type VerificationStatus = (typeof VerificationStatus)[keyof typeof VerificationStatus];

export const OverallStatus = {
  VALIDATING: 'VALIDATING',
  INVALID: 'INVALID',
  BLOCKED: 'BLOCKED',
  QUEUED: 'QUEUED',
  PROCESSING: 'PROCESSING',
  DISCOVERY_ATTEMPTED: 'DISCOVERY_ATTEMPTED',
  CRAWL_DETECTED: 'CRAWL_DETECTED',
  INDEX_CHECK_PENDING: 'INDEX_CHECK_PENDING',
  INDEXED_CONFIRMED: 'INDEXED_CONFIRMED',
  NOT_CONFIRMED_INDEXED: 'NOT_CONFIRMED_INDEXED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
} as const;
export type OverallStatus = (typeof OverallStatus)[keyof typeof OverallStatus];

export interface StatusDimensions {
  validationStatus: ValidationStatus;
  processingStatus: ProcessingStatus;
  verificationStatus: VerificationStatus;
}

/**
 * Derives the single label shown in the UI.
 *
 * Deliberate rule: a successful discovery submission is NEVER reported as
 * "indexed". Only an explicit verification result can produce an indexed label.
 */
export function deriveOverallStatus({
  validationStatus,
  processingStatus,
  verificationStatus,
}: StatusDimensions): OverallStatus {
  if (validationStatus === ValidationStatus.BLOCKED) return OverallStatus.BLOCKED;
  if (validationStatus === ValidationStatus.INVALID) return OverallStatus.INVALID;
  if (
    validationStatus === ValidationStatus.RECEIVED ||
    validationStatus === ValidationStatus.VALIDATING
  ) {
    return OverallStatus.VALIDATING;
  }

  if (verificationStatus === VerificationStatus.INDEXED_CONFIRMED) {
    return OverallStatus.INDEXED_CONFIRMED;
  }
  if (verificationStatus === VerificationStatus.NOT_CONFIRMED_INDEXED) {
    return OverallStatus.NOT_CONFIRMED_INDEXED;
  }

  switch (processingStatus) {
    case ProcessingStatus.CANCELLED:
      return OverallStatus.CANCELLED;
    case ProcessingStatus.FAILED:
      return OverallStatus.FAILED;
    case ProcessingStatus.PROCESSING:
      return OverallStatus.PROCESSING;
    case ProcessingStatus.QUEUED:
      return OverallStatus.QUEUED;
    case ProcessingStatus.CRAWL_DETECTED:
      return verificationStatus === VerificationStatus.PENDING
        ? OverallStatus.INDEX_CHECK_PENDING
        : OverallStatus.CRAWL_DETECTED;
    case ProcessingStatus.DISCOVERY_ATTEMPTED:
      return verificationStatus === VerificationStatus.PENDING
        ? OverallStatus.INDEX_CHECK_PENDING
        : OverallStatus.DISCOVERY_ATTEMPTED;
    case ProcessingStatus.NOT_QUEUED:
    default:
      return OverallStatus.QUEUED;
  }
}

export const OVERALL_STATUS_LABELS: Record<OverallStatus, string> = {
  VALIDATING: 'Validating',
  INVALID: 'Invalid',
  BLOCKED: 'Blocked',
  QUEUED: 'Queued',
  PROCESSING: 'Processing',
  DISCOVERY_ATTEMPTED: 'Discovery attempted',
  CRAWL_DETECTED: 'Crawl detected',
  INDEX_CHECK_PENDING: 'Index check pending',
  INDEXED_CONFIRMED: 'Indexed (confirmed)',
  NOT_CONFIRMED_INDEXED: 'Not confirmed indexed',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
};

/**
 * Statuses that terminate the pipeline. Used by refund rules and by the UI to
 * stop showing spinners.
 */
export const TERMINAL_OVERALL_STATUSES: OverallStatus[] = [
  OverallStatus.INVALID,
  OverallStatus.BLOCKED,
  OverallStatus.FAILED,
  OverallStatus.CANCELLED,
  OverallStatus.INDEXED_CONFIRMED,
  OverallStatus.NOT_CONFIRMED_INDEXED,
];
