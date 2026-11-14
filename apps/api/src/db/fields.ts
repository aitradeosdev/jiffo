import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { customType } from 'drizzle-orm/pg-core';
import { subKey } from '../common/keys';

/**
 * Personal details encrypted at rest (docs/security-plan.md, I6): legal names, dates of birth, home
 * addresses, emergency contacts and payout accounts. The database holds only AES-256-GCM ciphertext, bound
 * to its table and column so one value can't be moved into another; the API reads and writes them as plain
 * text. A value saved before encryption (no prefix) still reads as it was, and is encrypted on its next
 * write or by the backfill at startup (FieldsBackfill).
 */
const PREFIX = 'enc1:';
let fieldKey: Buffer | null = null;
let indexKey: Buffer | null = null;

/** Sets the key (FIELD_KEY) once, when the database module starts. */
export function useFieldKey(key: Buffer) {
  fieldKey = key;
  indexKey = subKey(key, 'jiffo field index');
}

function keyOrThrow() {
  if (!fieldKey) throw new Error('The field key is not set: personal details cannot be read or written');
  return fieldKey;
}

export function sealField(where: string, value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyOrThrow(), iv);
  cipher.setAAD(Buffer.from(where));
  const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
}

export function openField(where: string, stored: string): string {
  if (!stored.startsWith(PREFIX)) return stored;
  const raw = Buffer.from(stored.slice(PREFIX.length), 'base64url');
  const decipher = createDecipheriv('aes-256-gcm', keyOrThrow(), raw.subarray(0, 12));
  decipher.setAAD(Buffer.from(where));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
}

export const isSealed = (stored: string | null) => !!stored && stored.startsWith(PREFIX);

/** A text column kept encrypted: `encrypted('agent_applications', 'legal_name')`. */
export const encrypted = (table: string, column: string) =>
  customType<{ data: string; driverData: string }>({
    dataType: () => 'text',
    toDriver: (value) => sealField(`${table}.${column}`, value),
    fromDriver: (value) => openField(`${table}.${column}`, value),
  })(column);

/** The words of a name, as the search index keeps them: upper case, letters only. */
const nameWords = (name: string) =>
  name
    .toUpperCase()
    .split(/[^A-Z]+/)
    .filter((w) => w.length > 1);

/**
 * A keyed hash of each word of a name, so support can still find someone by any whole word of their
 * legal name without the name being stored readable. Null for no name.
 */
export function nameIndex(name: string | null | undefined): string[] | null {
  if (!name) return null;
  if (!indexKey) keyOrThrow();
  const words = [...new Set(nameWords(name))];
  return words.length ? words.map((w) => createHmac('sha256', indexKey!).update(w).digest('hex').slice(0, 32)) : null;
}

/** The index entries a search must all match: one per whole word typed. */
export const searchIndex = (query: string) => nameIndex(query) ?? [];
