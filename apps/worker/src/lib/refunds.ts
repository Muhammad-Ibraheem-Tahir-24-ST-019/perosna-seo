import { prisma, refundCredits } from '@indexpilot/db';
import { logger } from './runtime.js';

/**
 * Refunds the credits charged for a URL that the platform could not usefully
 * process (invalid, blocked, or definitively failed).
 *
 * Idempotency comes from the ledger's unique (wallet, type, referenceType,
 * referenceId) constraint: calling this twice for the same URL performs one
 * refund and reports the second call as a replay.
 */
export async function refundUrl(urlId: string, reason: string): Promise<void> {
  const url = await prisma.urlRecord.findUnique({
    where: { id: urlId },
    select: { id: true, userId: true, creditsCharged: true, refundedAt: true },
  });
  if (!url || url.creditsCharged <= 0 || url.refundedAt) return;

  try {
    const movement = await refundCredits({
      userId: url.userId,
      amount: url.creditsCharged,
      referenceType: 'url',
      referenceId: url.id,
      description: `Refund: ${reason}`,
    });
    await prisma.urlRecord.update({
      where: { id: url.id },
      data: { refundedAt: new Date() },
    });
    logger.info(
      { urlId, credits: url.creditsCharged, replayed: movement.replayed },
      'refunded credits',
    );
  } catch (error) {
    logger.error({ err: error, urlId }, 'refund failed');
  }
}
