import { createHmac } from 'node:crypto';
import { customType } from 'drizzle-orm/pg-core';
import { subKey } from '../common/keys';
import { nameWords } from '../common/names';
import { SecretBox } from '../providers/secret-box';

/**
 * Personal details encrypted at rest (docs/security-plan.md, I6): legal names, dates of birth, home
 * addresses, emergency contacts and payout accounts. The database holds only AES-256-GCM ciphertext (a
 * SecretBox under FIELD_KEY), bound to its table and column so one value can't be moved into another; the
 * API reads and writes them as plain text. A value saved before encryption (no prefix) still reads as it
 * was, and is encrypted on its next write or by the backfill at startup (FieldsBackfill).
 */
const PREFIX = 'enc:';
let box: SecretBox | null = null;
let current: string | null = null;
let indexKey: Buffer | null = null;

/** Sets the key (FIELD_KEY) when the database starts. One key per process: a second, different one is refused. */
export function useFieldKey(key: Buffer) {
  const hex = key.toString('hex');
  if (current === hex) return;
  if (current) throw new Error('A different field key is already in use in this process');
  current = hex;
  box = new SecretBox(hex, 'jiffo personal fields v1');
  indexKey = subKey(key, 'jiffo field index');
}

function boxOrThrow() {
  if (!box) throw new Error('The field key is not set: personal details cannot be read or written');
  return box;
}

export const sealField = (where: string, value: string) => PREFIX + boxOrThrow().seal(value, where);

export const openField = (where: string, stored: string) =>
  stored.startsWith(PREFIX) ? boxOrThrow().open(stored.slice(PREFIX.length), where) : stored;

export const isSealed = (stored: string | null) => !!stored && stored.startsWith(PREFIX);

/** A text column kept encrypted: `encrypted('agent_applications', 'legal_name')`. */
export const encrypted = (table: string, column: string) =>
  customType<{ data: string; driverData: string }>({
    dataType: () => 'text',
    toDriver: (value) => sealField(`${table}.${column}`, value),
    fromDriver: (value) => openField(`${table}.${column}`, value),
  })(column);

/**
 * A keyed hash of each word of a name (lower case, accents removed, as names are compared elsewhere), so
 * support can still find someone by any whole word of their legal name without it being stored readable.
 * Null for no name; an empty list for a name with no word to search by.
 */
export function nameIndex(name: string | null | undefined): string[] | null {
  if (name === null || name === undefined) return null;
  boxOrThrow();
  return [...nameWords(name)]
    .filter((w) => w.length > 1)
    .map((w) => createHmac('sha256', indexKey!).update(w).digest('hex').slice(0, 32));
}

/** The index entries a search must all match: one per whole word typed. */
export const searchIndex = (query: string) => nameIndex(query) ?? [];
