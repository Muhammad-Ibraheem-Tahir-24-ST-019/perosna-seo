import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from './constants.js';
import { badRequest } from './errors.js';

export interface Cursor {
  createdAt: string;
  id: string;
}

/** Opaque, stable cursor over (createdAt desc, id desc). */
export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function decodeCursor(value: string): Cursor {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as Cursor).id === 'string' &&
      typeof (parsed as Cursor).createdAt === 'string' &&
      !Number.isNaN(Date.parse((parsed as Cursor).createdAt))
    ) {
      return parsed as Cursor;
    }
  } catch {
    /* falls through to the error below */
  }
  throw badRequest('Invalid pagination cursor.');
}

export function clampLimit(limit?: number): number {
  if (limit === undefined || Number.isNaN(limit)) return DEFAULT_PAGE_SIZE;
  return Math.min(Math.max(Math.trunc(limit), 1), MAX_PAGE_SIZE);
}
