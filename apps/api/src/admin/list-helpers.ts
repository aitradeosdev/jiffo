import { sql, type AnyColumn } from 'drizzle-orm';
import { badRequest } from '../common/errors';

/**
 * Admin lists page by creation time to the microsecond, as Postgres keeps it, then id, so no row is skipped
 * or repeated between pages, even several created in the same millisecond.
 */
export const exactTime = (column: AnyColumn) =>
  sql<string>`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

const CURSOR = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z)_([0-9a-f-]{36})$/i;

export const cursorOf = (row: { cursorAt: string; id: string }) => `${row.cursorAt}_${row.id}`;

/** The page link's time and id, ready to compare with (created_at, id) < (at::timestamptz, id::uuid). */
export function parseCursor(cursor: string | undefined) {
  if (!cursor) return null;
  const m = CURSOR.exec(cursor);
  if (!m) throw badRequest('invalid_cursor', 'That page link is not valid');
  return { at: m[1]!, id: m[2]! };
}

/** A LIKE pattern that finds the text anywhere, with the user's own % and _ taken literally. */
export const containing = (text: string) => `%${text.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/**
 * The part of a typed phone number worth matching, however it was written (0803..., +234 803..., 803 123
 * 4567), or null when too few digits are left to mean anything.
 */
export function phoneDigits(text: string): string | null {
  const local = text.replace(/[^\d]/g, '').replace(/^(234|0)/, '');
  return local.length >= 4 ? local : null;
}

/** Part of an id, as support reads it out from a screenshot. */
export const idPrefix = (text: string) =>
  /^[0-9a-f-]{6,36}$/i.test(text.trim()) ? `${text.trim().toLowerCase()}%` : null;
