import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  adjustCredits,
  debitCredits,
  getBalance,
  grantBonusCredits,
  prisma,
  purchaseCredits,
  reconcileWallet,
  refundCredits,
} from '../../packages/db/src/index.js';
import { AppError } from '../../packages/shared/src/errors.js';
import { infrastructureAvailable, uniqueEmail } from './helpers.js';

const available = await infrastructureAvailable();

async function createUser(): Promise<string> {
  const user = await prisma.user.create({
    data: {
      email: uniqueEmail('ledger'),
      passwordHash: 'scrypt:00:00',
      wallet: { create: { cachedBalance: 0 } },
    },
  });
  return user.id;
}

describe.skipIf(!available)('credit ledger (PostgreSQL)', () => {
  const createdUsers: string[] = [];

  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: createdUsers } } });
  });

  it('writes an immutable ledger row for every movement and stays reconcilable', async () => {
    const userId = await createUser();
    createdUsers.push(userId);

    await grantBonusCredits({ userId, amount: 100, referenceType: 'test', referenceId: 'bonus-1' });
    await debitCredits({ userId, amount: 30, referenceType: 'batch', referenceId: 'b1' });
    await refundCredits({ userId, amount: 5, referenceType: 'url', referenceId: 'u1' });

    expect(await getBalance(userId)).toBe(75);
    const reconciliation = await reconcileWallet(userId);
    expect(reconciliation.consistent).toBe(true);
    expect(reconciliation.ledgerBalance).toBe(75);
  });

  it('debits a given reference exactly once, even when retried', async () => {
    const userId = await createUser();
    createdUsers.push(userId);
    await grantBonusCredits({ userId, amount: 50, referenceType: 'test', referenceId: 'seed' });

    const reference = { referenceType: 'submission_batch', referenceId: randomUUID() };
    const first = await debitCredits({ userId, amount: 10, ...reference });
    const retry = await debitCredits({ userId, amount: 10, ...reference });

    expect(first.replayed).toBe(false);
    expect(retry.replayed).toBe(true);
    expect(retry.transaction.id).toBe(first.transaction.id);
    expect(await getBalance(userId)).toBe(40);
  });

  it('refunds a URL exactly once', async () => {
    const userId = await createUser();
    createdUsers.push(userId);
    await grantBonusCredits({ userId, amount: 10, referenceType: 'test', referenceId: 'seed' });
    await debitCredits({ userId, amount: 1, referenceType: 'batch', referenceId: 'b' });

    await refundCredits({ userId, amount: 1, referenceType: 'url', referenceId: 'url-1' });
    await refundCredits({ userId, amount: 1, referenceType: 'url', referenceId: 'url-1' });

    expect(await getBalance(userId)).toBe(10);
  });

  it('credits a payment exactly once when the webhook is replayed', async () => {
    const userId = await createUser();
    createdUsers.push(userId);
    const paymentId = randomUUID();

    await Promise.all(
      Array.from({ length: 5 }, () =>
        purchaseCredits({ userId, amount: 500, referenceType: 'payment', referenceId: paymentId }).catch(
          () => null,
        ),
      ),
    );

    expect(await getBalance(userId)).toBe(500);
    expect((await reconcileWallet(userId)).consistent).toBe(true);
  });

  it('never lets concurrent debits overspend the balance', async () => {
    const userId = await createUser();
    createdUsers.push(userId);
    await grantBonusCredits({ userId, amount: 10, referenceType: 'test', referenceId: 'seed' });

    // 20 submissions of 1 credit race for a balance of 10.
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, (_, index) =>
        debitCredits({ userId, amount: 1, referenceType: 'batch', referenceId: `race-${index}` }),
      ),
    );

    const succeeded = results.filter((result) => result.status === 'fulfilled').length;
    const rejected = results.filter(
      (result) =>
        result.status === 'rejected' &&
        result.reason instanceof AppError &&
        result.reason.code === 'INSUFFICIENT_CREDITS',
    ).length;

    expect(succeeded).toBe(10);
    expect(rejected).toBe(10);
    expect(await getBalance(userId)).toBe(0);
    expect((await reconcileWallet(userId)).consistent).toBe(true);
  });

  it('rejects a debit larger than the balance without writing anything', async () => {
    const userId = await createUser();
    createdUsers.push(userId);
    await grantBonusCredits({ userId, amount: 3, referenceType: 'test', referenceId: 'seed' });

    await expect(
      debitCredits({ userId, amount: 4, referenceType: 'batch', referenceId: 'too-big' }),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_CREDITS' });

    expect(await getBalance(userId)).toBe(3);
    const rows = await prisma.creditTransaction.count({
      where: { wallet: { userId }, referenceId: 'too-big' },
    });
    expect(rows).toBe(0);
  });

  it('allows negative admin adjustments but never below zero', async () => {
    const userId = await createUser();
    createdUsers.push(userId);
    await grantBonusCredits({ userId, amount: 20, referenceType: 'test', referenceId: 'seed' });

    await adjustCredits({ userId, amount: -15, referenceType: 'admin', referenceId: 'adj-1' });
    expect(await getBalance(userId)).toBe(5);

    await expect(
      adjustCredits({ userId, amount: -6, referenceType: 'admin', referenceId: 'adj-2' }),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_CREDITS' });
    expect(await getBalance(userId)).toBe(5);
  });
});
