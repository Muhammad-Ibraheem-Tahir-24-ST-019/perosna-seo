import { Prisma, type CreditTransaction, type CreditTransactionType } from '@prisma/client';
import { insufficientCredits } from '@indexpilot/shared';
import { prisma } from './client.js';

/**
 * Credit ledger.
 *
 * Invariants enforced here (not by convention):
 *  1. Every balance change writes an immutable CreditTransaction row.
 *  2. (wallet, type, referenceType, referenceId) is unique, so a retried worker,
 *     a duplicated API submission or a replayed payment webhook can never apply
 *     the same movement twice.
 *  3. Balance is decremented with a conditional UPDATE ... WHERE balance >= n,
 *     so two concurrent submissions competing for the last credit cannot both win.
 */

export interface LedgerReference {
  referenceType: string;
  referenceId: string;
}

export interface LedgerMovement extends LedgerReference {
  userId: string;
  amount: number;
  description?: string;
}

export interface LedgerResult {
  transaction: CreditTransaction;
  balance: number;
  /** True when the movement had already been applied and was replayed. */
  replayed: boolean;
}

type Tx = Prisma.TransactionClient;

export async function getOrCreateWallet(userId: string, client: Tx | typeof prisma = prisma) {
  const existing = await client.creditWallet.findUnique({ where: { userId } });
  if (existing) return existing;
  return client.creditWallet.upsert({
    where: { userId },
    create: { userId, cachedBalance: 0 },
    update: {},
  });
}

export async function getBalance(userId: string): Promise<number> {
  const wallet = await prisma.creditWallet.findUnique({
    where: { userId },
    select: { cachedBalance: true },
  });
  return wallet?.cachedBalance ?? 0;
}

/**
 * Spends credits. Throws AppError(INSUFFICIENT_CREDITS) when the balance cannot
 * cover the amount at the moment of the write.
 */
export async function debitCredits(movement: LedgerMovement): Promise<LedgerResult> {
  if (movement.amount <= 0) {
    throw new Error('debitCredits requires a positive amount.');
  }
  return applyMovement({ ...movement, signedAmount: -movement.amount, type: 'SUBMISSION_DEBIT' });
}

export async function refundCredits(movement: LedgerMovement): Promise<LedgerResult> {
  if (movement.amount <= 0) throw new Error('refundCredits requires a positive amount.');
  return applyMovement({ ...movement, signedAmount: movement.amount, type: 'REFUND' });
}

export async function purchaseCredits(movement: LedgerMovement): Promise<LedgerResult> {
  if (movement.amount <= 0) throw new Error('purchaseCredits requires a positive amount.');
  return applyMovement({ ...movement, signedAmount: movement.amount, type: 'PURCHASE' });
}

export async function grantBonusCredits(movement: LedgerMovement): Promise<LedgerResult> {
  if (movement.amount <= 0) throw new Error('grantBonusCredits requires a positive amount.');
  return applyMovement({ ...movement, signedAmount: movement.amount, type: 'BONUS' });
}

/**
 * Claws back credits granted by a payment that was later refunded.
 *
 * Keyed on the payment reference, so repeating it is a no-op. If the customer
 * has already spent the credits the caller decides whether to reverse only what
 * is left (see `reverseCreditsPartial`).
 */
export async function reverseCredits(movement: LedgerMovement): Promise<LedgerResult> {
  if (movement.amount <= 0) throw new Error('reverseCredits requires a positive amount.');
  return applyMovement({ ...movement, signedAmount: -movement.amount, type: 'REVERSAL' });
}

/** Admin adjustment. `amount` may be negative; a reason is required by the caller. */
export async function adjustCredits(
  movement: LedgerMovement & { amount: number },
): Promise<LedgerResult> {
  if (movement.amount === 0) throw new Error('adjustCredits requires a non-zero amount.');
  return applyMovement({ ...movement, signedAmount: movement.amount, type: 'ADMIN_ADJUSTMENT' });
}

export interface TxMovement extends LedgerReference {
  userId: string;
  /** Negative spends, positive credits. */
  signedAmount: number;
  type: CreditTransactionType;
  description?: string;
}

type InternalMovement = LedgerMovement & Omit<TxMovement, keyof LedgerReference | 'userId'>;

/**
 * Ledger write that participates in a caller supplied transaction, so credits
 * and the work they pay for commit or roll back together.
 *
 * Throws AppError(INSUFFICIENT_CREDITS) when the balance cannot cover the move,
 * and PrismaClientKnownRequestError P2002 when the movement already exists.
 */
export async function applyMovementTx(tx: Tx, movement: TxMovement): Promise<LedgerResult> {
  const { userId, signedAmount, type, referenceType, referenceId, description } = movement;
  const wallet = await getOrCreateWallet(userId, tx);

  // Conditional, atomic balance move. The WHERE clause is the race guard:
  // concurrent debits serialise on the row and the loser sees 0 rows.
  const rows = await tx.$queryRaw<Array<{ cachedBalance: number }>>`
    UPDATE credit_wallets
       SET "cachedBalance" = "cachedBalance" + ${signedAmount},
           "lifetimeSpent" = "lifetimeSpent" + ${signedAmount < 0 ? -signedAmount : 0},
           "updatedAt" = NOW()
     WHERE id = ${wallet.id}
       AND "cachedBalance" + ${signedAmount} >= 0
    RETURNING "cachedBalance"
  `;

  const updated = rows[0];
  if (!updated) {
    throw insufficientCredits(Math.abs(signedAmount), wallet.cachedBalance);
  }

  const transaction = await tx.creditTransaction.create({
    data: {
      walletId: wallet.id,
      amount: signedAmount,
      type,
      referenceType,
      referenceId,
      description: description ?? null,
      balanceAfter: updated.cachedBalance,
    },
  });

  return { transaction, balance: updated.cachedBalance, replayed: false };
}

async function applyMovement(movement: InternalMovement): Promise<LedgerResult> {
  const { userId, type, referenceType, referenceId } = movement;

  try {
    return await prisma.$transaction((tx) => applyMovementTx(tx, movement));
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      // The movement already exists. The transaction above rolled back, so the
      // balance is untouched: return the original ledger row instead.
      const wallet = await getOrCreateWallet(userId);
      const existing = await prisma.creditTransaction.findFirst({
        where: { walletId: wallet.id, type, referenceType, referenceId },
      });
      if (existing) {
        return { transaction: existing, balance: wallet.cachedBalance, replayed: true };
      }
    }
    throw error;
  }
}

export interface WalletReconciliation {
  walletId: string;
  cachedBalance: number;
  ledgerBalance: number;
  drift: number;
  consistent: boolean;
}

/** Recomputes the balance from the immutable ledger. Used by admin + health checks. */
export async function reconcileWallet(userId: string): Promise<WalletReconciliation> {
  const wallet = await getOrCreateWallet(userId);
  const aggregate = await prisma.creditTransaction.aggregate({
    where: { walletId: wallet.id },
    _sum: { amount: true },
  });
  const ledgerBalance = aggregate._sum.amount ?? 0;
  return {
    walletId: wallet.id,
    cachedBalance: wallet.cachedBalance,
    ledgerBalance,
    drift: wallet.cachedBalance - ledgerBalance,
    consistent: wallet.cachedBalance === ledgerBalance,
  };
}

export async function listTransactions(
  userId: string,
  options: { take: number; cursorId?: string },
): Promise<CreditTransaction[]> {
  const wallet = await getOrCreateWallet(userId);
  return prisma.creditTransaction.findMany({
    where: { walletId: wallet.id },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: options.take,
    ...(options.cursorId ? { cursor: { id: options.cursorId }, skip: 1 } : {}),
  });
}
