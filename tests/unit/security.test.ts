import { describe, expect, it } from 'vitest';
import {
  constantTimeEquals,
  decryptSecret,
  encryptSecret,
  hashPassword,
  hashToken,
  randomToken,
  verifyPassword,
} from '../../packages/shared/src/crypto.js';
import { clampLimit, decodeCursor, encodeCursor } from '../../packages/shared/src/pagination.js';
import { AppError, isAppError, insufficientCredits } from '../../packages/shared/src/errors.js';

describe('password hashing', () => {
  it('verifies a correct password and rejects a wrong one', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('correct horse battery staple', hash)).toBe(true);
    expect(await verifyPassword('wrong password entirely', hash)).toBe(false);
  });

  it('never stores the plaintext and salts every hash', async () => {
    const a = await hashPassword('same-password-1');
    const b = await hashPassword('same-password-1');
    expect(a).not.toContain('same-password-1');
    expect(a).not.toBe(b);
    expect(await verifyPassword('same-password-1', b)).toBe(true);
  });

  it('rejects malformed stored hashes instead of throwing', async () => {
    expect(await verifyPassword('x', 'not-a-hash')).toBe(false);
    expect(await verifyPassword('x', 'scrypt:aa:bb')).toBe(false);
  });
});

describe('token hashing', () => {
  it('is deterministic and does not reveal the token', () => {
    const token = randomToken(32);
    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(token)).not.toContain(token);
    expect(hashToken(token)).toHaveLength(64);
  });

  it('compares in constant time without throwing on length mismatch', () => {
    expect(constantTimeEquals('abc', 'abc')).toBe(true);
    expect(constantTimeEquals('abc', 'abd')).toBe(false);
    expect(constantTimeEquals('abc', 'abcd')).toBe(false);
  });
});

describe('secret encryption', () => {
  const key = 'a'.repeat(64);

  it('round-trips provider credentials', () => {
    const payload = encryptSecret('super-secret-api-key', key);
    expect(payload).not.toContain('super-secret-api-key');
    expect(decryptSecret(payload, key)).toBe('super-secret-api-key');
  });

  it('fails loudly when the ciphertext is tampered with', () => {
    const payload = encryptSecret('value', key);
    const parts = payload.split('.');
    const tampered = [parts[0], parts[1], parts[2], Buffer.from('other').toString('base64')].join('.');
    expect(() => decryptSecret(tampered, key)).toThrow();
  });

  it('rejects an unknown envelope version', () => {
    expect(() => decryptSecret('v2.a.b.c', key)).toThrow(/Unsupported/);
  });
});

describe('pagination cursors', () => {
  it('round-trips a cursor', () => {
    const cursor = { createdAt: new Date().toISOString(), id: 'abc123' };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it('rejects malformed cursors with a 400-class error', () => {
    expect(() => decodeCursor('not-base64!!')).toThrow(AppError);
    expect(() => decodeCursor(Buffer.from('{}').toString('base64url'))).toThrow(AppError);
  });

  it('clamps page size to a sane range', () => {
    expect(clampLimit(undefined)).toBe(25);
    expect(clampLimit(0)).toBe(1);
    expect(clampLimit(10_000)).toBe(200);
    expect(clampLimit(50)).toBe(50);
  });
});

describe('application errors', () => {
  it('marks 5xx errors as not exposable', () => {
    const error = new AppError('INTERNAL', 'db exploded', 500);
    expect(isAppError(error)).toBe(true);
    expect(error.expose).toBe(false);
  });

  it('carries the shortfall on insufficient credits', () => {
    const error = insufficientCredits(100, 12);
    expect(error.statusCode).toBe(402);
    expect(error.details).toEqual({ required: 100, available: 12 });
  });
});
