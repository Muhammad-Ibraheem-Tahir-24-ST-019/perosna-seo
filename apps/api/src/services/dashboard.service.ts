import { getOrCreateWallet, prisma } from '@indexpilot/db';
import type { DashboardMetrics, DashboardSeriesPoint, SessionUser } from '@indexpilot/shared';
import { getStatsForProjects, toSummary } from './project.service.js';
import { toUrlListItem } from './url.service.js';

interface SeriesRow {
  day: Date;
  submitted: bigint;
  processed: bigint;
  crawl_detected: bigint;
  indexed_confirmed: bigint;
  failed: bigint;
}

/**
 * Every number on the dashboard is computed from the database. Aggregation runs
 * in SQL so a 100k-URL account does not ship 100k rows to the browser.
 */
export async function getDashboardMetrics(
  user: SessionUser,
  days = 30,
): Promise<DashboardMetrics> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const [wallet, projectCount, statusRows, seriesRows, recentProjects, recentUrls] =
    await Promise.all([
      getOrCreateWallet(user.id),
      prisma.project.count({ where: { userId: user.id, status: 'ACTIVE' } }),
      prisma.$queryRaw<
        Array<{
          validationStatus: string;
          processingStatus: string;
          verificationStatus: string;
          count: bigint;
        }>
      >`
        SELECT "validationStatus"::text   AS "validationStatus",
               "processingStatus"::text   AS "processingStatus",
               "verificationStatus"::text AS "verificationStatus",
               COUNT(*)                   AS count
          FROM url_records
         WHERE "userId" = ${user.id}
         GROUP BY 1, 2, 3
      `,
      prisma.$queryRaw<SeriesRow[]>`
        SELECT date_trunc('day', "createdAt")::date AS day,
               COUNT(*) AS submitted,
               COUNT(*) FILTER (
                 WHERE "processingStatus" IN ('DISCOVERY_ATTEMPTED', 'CRAWL_DETECTED')
               ) AS processed,
               COUNT(*) FILTER (WHERE "processingStatus" = 'CRAWL_DETECTED') AS crawl_detected,
               COUNT(*) FILTER (WHERE "verificationStatus" = 'INDEXED_CONFIRMED') AS indexed_confirmed,
               COUNT(*) FILTER (WHERE "processingStatus" = 'FAILED') AS failed
          FROM url_records
         WHERE "userId" = ${user.id}
           AND "createdAt" >= ${since}
         GROUP BY 1
         ORDER BY 1 ASC
      `,
      prisma.project.findMany({
        where: { userId: user.id, status: 'ACTIVE' },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
      prisma.urlRecord.findMany({
        where: { userId: user.id },
        orderBy: { updatedAt: 'desc' },
        take: 10,
        include: { project: { select: { name: true } } },
      }),
    ]);

  const totals = {
    totalUrls: 0,
    processed: 0,
    crawlDetected: 0,
    indexedConfirmed: 0,
    notConfirmedIndexed: 0,
    pending: 0,
    failed: 0,
    blocked: 0,
    invalid: 0,
    projects: projectCount,
    credits: wallet.cachedBalance,
  };

  for (const row of statusRows) {
    const count = Number(row.count);
    totals.totalUrls += count;
    if (row.validationStatus === 'BLOCKED') totals.blocked += count;
    if (row.validationStatus === 'INVALID') totals.invalid += count;
    if (
      row.processingStatus === 'DISCOVERY_ATTEMPTED' ||
      row.processingStatus === 'CRAWL_DETECTED'
    ) {
      totals.processed += count;
    }
    if (row.processingStatus === 'CRAWL_DETECTED') totals.crawlDetected += count;
    if (row.processingStatus === 'FAILED') totals.failed += count;
    if (row.verificationStatus === 'INDEXED_CONFIRMED') totals.indexedConfirmed += count;
    if (row.verificationStatus === 'NOT_CONFIRMED_INDEXED') totals.notConfirmedIndexed += count;
    if (
      (row.processingStatus === 'QUEUED' ||
        row.processingStatus === 'NOT_QUEUED' ||
        row.processingStatus === 'PROCESSING') &&
      row.validationStatus !== 'INVALID' &&
      row.validationStatus !== 'BLOCKED'
    ) {
      totals.pending += count;
    }
  }

  const stats = await getStatsForProjects(recentProjects.map((project) => project.id));

  return {
    totals,
    series: fillSeries(seriesRows, since, days),
    recentProjects: recentProjects.map((project) =>
      toSummary(project, stats.get(project.id) ?? emptyProjectStats()),
    ),
    recentUrls: recentUrls.map((url) => toUrlListItem(url, url.project.name)),
  };
}

function emptyProjectStats() {
  return {
    totalUrls: 0,
    creditsSpent: 0,
    valid: 0,
    invalid: 0,
    blocked: 0,
    queued: 0,
    processing: 0,
    discoveryAttempted: 0,
    crawlDetected: 0,
    indexedConfirmed: 0,
    notConfirmedIndexed: 0,
    failed: 0,
    pending: 0,
  };
}

/** Produces one point per day so charts do not have gaps. */
function fillSeries(rows: SeriesRow[], since: Date, days: number): DashboardSeriesPoint[] {
  const byDay = new Map<string, SeriesRow>();
  for (const row of rows) {
    byDay.set(new Date(row.day).toISOString().slice(0, 10), row);
  }
  const points: DashboardSeriesPoint[] = [];
  for (let i = 0; i < days; i += 1) {
    const date = new Date(since.getTime() + i * 24 * 60 * 60 * 1000);
    const key = date.toISOString().slice(0, 10);
    const row = byDay.get(key);
    points.push({
      date: key,
      submitted: Number(row?.submitted ?? 0),
      processed: Number(row?.processed ?? 0),
      crawlDetected: Number(row?.crawl_detected ?? 0),
      indexedConfirmed: Number(row?.indexed_confirmed ?? 0),
      failed: Number(row?.failed ?? 0),
    });
  }
  return points;
}
