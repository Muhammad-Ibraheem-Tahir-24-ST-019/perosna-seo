'use client';

import { OVERALL_STATUS_LABELS, type OverallStatus } from '@indexpilot/shared/client';
import { Badge, type BadgeProps } from '@/components/ui/core';

const VARIANT: Record<OverallStatus, BadgeProps['variant']> = {
  VALIDATING: 'secondary',
  INVALID: 'destructive',
  BLOCKED: 'destructive',
  QUEUED: 'secondary',
  PROCESSING: 'default',
  DISCOVERY_ATTEMPTED: 'default',
  CRAWL_DETECTED: 'default',
  INDEX_CHECK_PENDING: 'warning',
  INDEXED_CONFIRMED: 'success',
  NOT_CONFIRMED_INDEXED: 'warning',
  FAILED: 'destructive',
  CANCELLED: 'outline',
};

/**
 * Status vocabulary shown to customers.
 *
 * "Not confirmed indexed" is intentionally distinct from "not indexed": the
 * platform can only report what a check observed, and public checks cannot see
 * the whole index.
 */
const TOOLTIP: Partial<Record<OverallStatus, string>> = {
  DISCOVERY_ATTEMPTED: 'Submitted to a discovery provider. This is not an indexing guarantee.',
  CRAWL_DETECTED: 'A crawl signal was observed for this URL.',
  INDEX_CHECK_PENDING: 'Waiting for the next scheduled index check.',
  INDEXED_CONFIRMED: 'A check observed this URL in search results.',
  NOT_CONFIRMED_INDEXED:
    'The check did not find this URL. Public lookups do not cover the full index, so it may still be indexed.',
  BLOCKED: 'Blocked before processing (robots.txt, noindex or network policy).',
};

export function StatusBadge({ status }: { status: OverallStatus }) {
  return (
    <Badge variant={VARIANT[status]} title={TOOLTIP[status]}>
      {OVERALL_STATUS_LABELS[status]}
    </Badge>
  );
}

export const STATUS_FILTER_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'all', label: 'All statuses' },
  { value: 'VALIDATING', label: 'Validating' },
  { value: 'QUEUED', label: 'Queued' },
  { value: 'PROCESSING', label: 'Processing' },
  { value: 'DISCOVERY_ATTEMPTED', label: 'Discovery attempted' },
  { value: 'CRAWL_DETECTED', label: 'Crawl detected' },
  { value: 'INDEX_CHECK_PENDING', label: 'Index check pending' },
  { value: 'INDEXED_CONFIRMED', label: 'Indexed (confirmed)' },
  { value: 'NOT_CONFIRMED_INDEXED', label: 'Not confirmed indexed' },
  { value: 'BLOCKED', label: 'Blocked' },
  { value: 'INVALID', label: 'Invalid' },
  { value: 'FAILED', label: 'Failed' },
];
