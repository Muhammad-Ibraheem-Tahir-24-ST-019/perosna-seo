import { prisma, type Report } from '@indexpilot/db';
import { createStorageProvider } from '@indexpilot/providers';
import { badRequest, notFound, type ReportItem, type SessionUser } from '@indexpilot/shared';
import { enqueueReport } from '../lib/queue.js';
import { requireOwnedProject } from './project.service.js';

export const REPORT_FILTERS = [
  'all',
  'indexed_confirmed',
  'not_confirmed',
  'failed',
  'blocked',
  'pending',
] as const;
export type ReportFilter = (typeof REPORT_FILTERS)[number];

export async function createReport(
  user: SessionUser,
  input: { projectId?: string; filter: ReportFilter },
): Promise<ReportItem> {
  if (!REPORT_FILTERS.includes(input.filter)) {
    throw badRequest(`Unknown report filter "${input.filter}".`);
  }
  if (input.projectId) await requireOwnedProject(user, input.projectId);

  const report = await prisma.report.create({
    data: {
      userId: user.id,
      projectId: input.projectId ?? null,
      filter: input.filter,
      format: 'CSV',
      status: 'QUEUED',
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
    include: { project: { select: { name: true } } },
  });

  await enqueueReport({ reportId: report.id });
  return toReportItem(report, report.project?.name ?? null);
}

export async function listReports(user: SessionUser, limit = 25): Promise<ReportItem[]> {
  const reports = await prisma.report.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    take: Math.min(limit, 100),
    include: { project: { select: { name: true } } },
  });
  return reports.map((report) => toReportItem(report, report.project?.name ?? null));
}

export async function getReport(user: SessionUser, reportId: string): Promise<ReportItem> {
  const report = await prisma.report.findUnique({
    where: { id: reportId },
    include: { project: { select: { name: true } } },
  });
  if (!report || report.userId !== user.id) throw notFound('Report not found.');
  return toReportItem(report, report.project?.name ?? null);
}

/** Returns the CSV bytes for a ready report, enforcing ownership and expiry. */
export async function downloadReport(
  user: SessionUser,
  reportId: string,
): Promise<{ filename: string; body: Buffer }> {
  const report = await prisma.report.findUnique({ where: { id: reportId } });
  if (!report || report.userId !== user.id) throw notFound('Report not found.');
  if (report.status !== 'READY' || !report.storageKey) {
    throw badRequest('This report is not ready yet.');
  }
  if (report.expiresAt && report.expiresAt.getTime() < Date.now()) {
    throw badRequest('This report has expired. Generate a new one.');
  }
  const body = await createStorageProvider().get(report.storageKey);
  return { filename: `indexpilot-report-${report.id}.csv`, body };
}

export function toReportItem(report: Report, projectName: string | null): ReportItem {
  return {
    id: report.id,
    projectId: report.projectId,
    projectName,
    status: report.status,
    format: report.format,
    filter: report.filter,
    rowCount: report.rowCount,
    errorMessage: report.errorMessage,
    createdAt: report.createdAt.toISOString(),
    completedAt: report.completedAt?.toISOString() ?? null,
    expiresAt: report.expiresAt?.toISOString() ?? null,
    downloadUrl: report.status === 'READY' ? `/api/v1/reports/${report.id}/download` : null,
  };
}
