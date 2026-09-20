import { describe, expect, it } from 'vitest';
import {
  deriveOverallStatus,
  OverallStatus,
  ProcessingStatus,
  ValidationStatus,
  VerificationStatus,
} from '../../packages/shared/src/status.js';

/**
 * The core product rule lives in this function: a successful provider
 * submission must never surface as "indexed".
 */
describe('deriveOverallStatus', () => {
  it('reports discovery submission as DISCOVERY_ATTEMPTED, not indexed', () => {
    expect(
      deriveOverallStatus({
        validationStatus: ValidationStatus.VALID,
        processingStatus: ProcessingStatus.DISCOVERY_ATTEMPTED,
        verificationStatus: VerificationStatus.NOT_CHECKED,
      }),
    ).toBe(OverallStatus.DISCOVERY_ATTEMPTED);
  });

  it('reports a crawl signal as CRAWL_DETECTED, not indexed', () => {
    expect(
      deriveOverallStatus({
        validationStatus: ValidationStatus.VALID,
        processingStatus: ProcessingStatus.CRAWL_DETECTED,
        verificationStatus: VerificationStatus.NOT_CHECKED,
      }),
    ).toBe(OverallStatus.CRAWL_DETECTED);
  });

  it('only reports INDEXED_CONFIRMED when verification confirmed it', () => {
    expect(
      deriveOverallStatus({
        validationStatus: ValidationStatus.VALID,
        processingStatus: ProcessingStatus.DISCOVERY_ATTEMPTED,
        verificationStatus: VerificationStatus.INDEXED_CONFIRMED,
      }),
    ).toBe(OverallStatus.INDEXED_CONFIRMED);
  });

  it('distinguishes "not confirmed" from "not indexed"', () => {
    expect(
      deriveOverallStatus({
        validationStatus: ValidationStatus.VALID,
        processingStatus: ProcessingStatus.CRAWL_DETECTED,
        verificationStatus: VerificationStatus.NOT_CONFIRMED_INDEXED,
      }),
    ).toBe(OverallStatus.NOT_CONFIRMED_INDEXED);
  });

  it('shows a pending index check while verification is scheduled', () => {
    expect(
      deriveOverallStatus({
        validationStatus: ValidationStatus.VALID,
        processingStatus: ProcessingStatus.DISCOVERY_ATTEMPTED,
        verificationStatus: VerificationStatus.PENDING,
      }),
    ).toBe(OverallStatus.INDEX_CHECK_PENDING);
  });

  it('lets validation failures win over any processing state', () => {
    expect(
      deriveOverallStatus({
        validationStatus: ValidationStatus.BLOCKED,
        processingStatus: ProcessingStatus.CRAWL_DETECTED,
        verificationStatus: VerificationStatus.INDEXED_CONFIRMED,
      }),
    ).toBe(OverallStatus.BLOCKED);

    expect(
      deriveOverallStatus({
        validationStatus: ValidationStatus.INVALID,
        processingStatus: ProcessingStatus.QUEUED,
        verificationStatus: VerificationStatus.NOT_CHECKED,
      }),
    ).toBe(OverallStatus.INVALID);
  });

  it('reports failures and cancellations', () => {
    expect(
      deriveOverallStatus({
        validationStatus: ValidationStatus.VALID,
        processingStatus: ProcessingStatus.FAILED,
        verificationStatus: VerificationStatus.NOT_CHECKED,
      }),
    ).toBe(OverallStatus.FAILED);

    expect(
      deriveOverallStatus({
        validationStatus: ValidationStatus.VALID,
        processingStatus: ProcessingStatus.CANCELLED,
        verificationStatus: VerificationStatus.NOT_CHECKED,
      }),
    ).toBe(OverallStatus.CANCELLED);
  });

  it('shows VALIDATING before the pre-flight check finishes', () => {
    expect(
      deriveOverallStatus({
        validationStatus: ValidationStatus.RECEIVED,
        processingStatus: ProcessingStatus.NOT_QUEUED,
        verificationStatus: VerificationStatus.NOT_CHECKED,
      }),
    ).toBe(OverallStatus.VALIDATING);
  });
});
