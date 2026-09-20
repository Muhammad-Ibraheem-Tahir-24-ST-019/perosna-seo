import type { Job } from 'bullmq';
import { env } from '@indexpilot/config';
import { type Prisma, prisma } from '@indexpilot/db';
import { createStorageProvider } from '@indexpilot/providers';
import { deriveOverallStatus, OVERALL_STATUS_LABELS } from '@indexpilot/shared';
import { logger } from '../lib/runtime.js';

export interface ReportJobData {
  reportId: string;
}

const PAGE_SIZE = 1_000;

const COLUMNS = [
  'url',
  'project',
  'status',
  'validation_status',
  'processing_status',
  'verification_status',
  'http_status',
  'final_url',
  'redirects',
  'robots_allowed',
  'noindex_detected',
  'canonical_url',
  'index_check_method',
  'index_check_confidence',
  'index_check_limitations',
  'last_index_check',
  'credits_charged',
  'refunded',
  'submitted_at',
  'updated_at',
];

/**
 * Generates a CSV report by paging through the database.
 *
 * The whole result set is never loaded at once, and the "status" column carries
 * the honest label (e.g. "Not confirmed indexed") rather than a binary
 * indexed/not-indexed claim.
 */
export async function processReportJob(job: Job<ReportJobData>): Promise<void> {
  const { reportId } = job.data;
  const report = await prisma.report.findUnique({ where: { id: reportId } });
  if (!report) return;
  if (report.status === 'READY') return;

  await prisma.report.update({ where: { id: reportId }, data: { status: 'GENERATING' } });

  try {
    const where: Prisma.UrlRecordWhereInput = {
      userId: report.userId,
      ...(report.projectId ? { projectId: report.projectId } : {}),
      ...filterToWhere(report.filter),
    };

    const rows: string[] = [COLUMNS.join(',')];
    let cursor: string | undefined;
    let total = 0;

    for (;;) {
      const page = await prisma.urlRecord.findMany({
        where,
        orderBy: { id: 'asc' },
        take: PAGE_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        include: {
          project: { select: { name: true } },
          validation: true,
          indexChecks: { orderBy: { checkedAt: 'desc' }, take: 1 },
        },
      });
      if (page.length === 0) break;

      for (const url of page) {
        const latestCheck = url.indexChecks[0];
        const overall = deriveOverallStatus({
          validationStatus: url.validationStatus,
          processingStatus: url.processingStatus,
          verificationStatus: url.verificationStatus,
        });
        rows.push(
          [
            url.normalizedUrl,
            url.project.name,
            OVERALL_STATUS_LABELS[overall],
            url.validationStatus,
            url.processingStatus,
            url.verificationStatus,
            url.validation?.httpStatus ?? '',
            url.validation?.finalUrl ?? '',
            url.validation?.redirectCount ?? 0,
            formatBool(url.validation?.robotsAllowed),
            formatBool(url.validation?.noindexDetected),
            url.validation?.canonicalUrl ?? '',
            latestCheck?.method ?? '',
            latestCheck?.confidence ?? '',
            latestCheck?.limitations ?? '',
            latestCheck?.checkedAt.toISOString() ?? '',
            url.creditsCharged,
            url.refundedAt ? 'yes' : 'no',
            url.createdAt.toISOString(),
            url.updatedAt.toISOString(),
          ]
            .map(csvCell)
            .join(','),
        );
      }

      total += page.length;
      cursor = page[page.length - 1]?.id;
      if (page.length < PAGE_SIZE) break;
    }

    const storageKey = `reports/${report.userId}/${report.id}.csv`;
    // A BOM keeps Excel from mangling non-ASCII URLs.
    const body = String.fromCharCode(0xfeff) + rows.join('\n') + '\n';
    await createStorageProvider().put(storageKey, body, 'text/csv; charset=utf-8');

    await prisma.report.update({
      where: { id: reportId },
      data: {
        status: 'READY',
        storageKey,
        rowCount: total,
        completedAt: new Date(),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
    logger.info({ reportId, rows: total }, 'report generated');
  } catch (error) {
    await prisma.report.update({
      where: { id: reportId },
      data: { status: 'FAILED', errorMessage: (error as Error).message.slice(0, 500) },
    });
    throw error;
  }
}

function filterToWhere(filter: string): Prisma.UrlRecordWhereInput {
  switch (filter) {
    case 'indexed_confirmed':
      return { verificationStatus: 'INDEXED_CONFIRMED' };
    case 'not_confirmed':
      return { verificationStatus: { in: ['NOT_CONFIRMED_INDEXED', 'ERROR'] } };
    case 'failed':
      return { processingStatus: 'FAILED' };
    case 'blocked':
      return { validationStatus: { in: ['BLOCKED', 'INVALID'] } };
    case 'pending':
      return {
        processingStatus: { in: ['NOT_QUEUED', 'QUEUED', 'PROCESSING'] },
        validationStatus: { notIn: ['INVALID', 'BLOCKED'] },
      };
    case 'all':
    default:
      return {};
  }
}

function formatBool(value: boolean | null | undefined): string {
  if (value === null || value === undefined) return 'unknown';
  return value ? 'yes' : 'no';
}

/** RFC4180 quoting; also neutralises spreadsheet formula injection. */
function csvCell(value: unknown): string {
  const raw = value === null || value === undefined ? '' : String(value);
  const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  if (/[",\n\r]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

export const reportConcurrency = env.WORKER_CONCURRENCY_REPORTS;
