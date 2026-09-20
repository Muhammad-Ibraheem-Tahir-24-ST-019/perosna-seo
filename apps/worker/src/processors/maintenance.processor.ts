import type { Job } from 'bullmq';
import { prisma } from '@indexpilot/db';
import { jobIds } from '@indexpilot/shared';
import {
  DEFAULT_JOB_OPTIONS,
  getQueue,
  getRegistry,
  logger,
  QUEUE_NAMES,
} from '../lib/runtime.js';

export interface MaintenanceJobData {
  task: 'sweep' | 'provider-health';
}

/**
 * Housekeeping that must not depend on anyone opening a page:
 *  - expires stale reports and sessions,
 *  - re-queues verification rounds that were missed while the worker was down,
 *  - refreshes provider health so the admin panel and routing stay accurate.
 */
export async function processMaintenanceJob(job: Job<MaintenanceJobData>): Promise<void> {
  const task = job.data?.task ?? 'sweep';

  if (task === 'provider-health') {
    await refreshProviderHealth();
    return;
  }

  const now = new Date();

  const [expiredReports, expiredSessions, expiredTokens] = await Promise.all([
    prisma.report.updateMany({
      where: { status: 'READY', expiresAt: { lt: now } },
      data: { status: 'EXPIRED' },
    }),
    prisma.session.deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - 86_400_000) } } }),
    prisma.verificationToken.deleteMany({ where: { expiresAt: { lt: now } } }),
  ]);

  // URLs whose job never reached Redis (enqueue failure, crash between the
  // database commit and the queue write) would otherwise sit untouched forever.
  const STUCK_AFTER_MS = 5 * 60 * 1000;
  const stuckCutoff = new Date(now.getTime() - STUCK_AFTER_MS);

  const stuckValidation = await prisma.urlRecord.findMany({
    where: {
      validationStatus: { in: ['RECEIVED', 'VALIDATING'] },
      updatedAt: { lt: stuckCutoff },
    },
    select: { id: true, projectId: true, userId: true },
    take: 500,
  });
  for (const url of stuckValidation) {
    await getQueue(QUEUE_NAMES.urlValidation).add(
      'validate-url',
      { urlId: url.id, projectId: url.projectId, userId: url.userId },
      { ...DEFAULT_JOB_OPTIONS, jobId: jobIds.validateUrl(url.id) },
    );
  }

  const stuckProcessing = await prisma.urlRecord.findMany({
    where: {
      validationStatus: 'VALID',
      processingStatus: { in: ['QUEUED', 'PROCESSING'] },
      updatedAt: { lt: stuckCutoff },
    },
    select: { id: true, projectId: true, userId: true },
    take: 500,
  });
  for (const url of stuckProcessing) {
    const attempts = await prisma.processingAttempt.count({ where: { urlId: url.id } });
    await getQueue(QUEUE_NAMES.urlProcessing).add(
      'process-url',
      { urlId: url.id, projectId: url.projectId, userId: url.userId, attemptNumber: attempts + 1 },
      { ...DEFAULT_JOB_OPTIONS, jobId: jobIds.processUrl(url.id, attempts + 1) },
    );
  }

  // Verification rounds that are due but have no live job (worker restart, etc).
  const dueVerifications = await prisma.urlRecord.findMany({
    where: {
      verificationStatus: 'PENDING',
      nextVerificationAt: { lte: now },
      validationStatus: 'VALID',
    },
    select: { id: true, verificationRound: true },
    take: 500,
  });

  for (const url of dueVerifications) {
    const round = url.verificationRound + 1;
    await getQueue(QUEUE_NAMES.indexVerification).add(
      'verify-url',
      { urlId: url.id, round },
      { ...DEFAULT_JOB_OPTIONS, jobId: jobIds.verifyUrl(url.id, round) },
    );
  }

  logger.info(
    {
      expiredReports: expiredReports.count,
      expiredSessions: expiredSessions.count,
      expiredTokens: expiredTokens.count,
      requeuedValidation: stuckValidation.length,
      requeuedProcessing: stuckProcessing.length,
      requeuedVerifications: dueVerifications.length,
    },
    'maintenance sweep complete',
  );
}

async function refreshProviderHealth(): Promise<void> {
  const registry = await getRegistry(true);
  for (const entry of registry.all()) {
    try {
      const health = await entry.provider.healthCheck();
      await prisma.discoveryProviderConfig.updateMany({
        where: { key: entry.config.key },
        data: {
          healthStatus: health.status,
          healthDetail: health.detail ?? null,
          lastHealthCheckAt: new Date(),
        },
      });
    } catch (error) {
      await prisma.discoveryProviderConfig.updateMany({
        where: { key: entry.config.key },
        data: {
          healthStatus: 'UNHEALTHY',
          healthDetail: (error as Error).message.slice(0, 300),
          lastHealthCheckAt: new Date(),
        },
      });
    }
  }
}
