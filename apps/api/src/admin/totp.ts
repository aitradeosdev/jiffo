import { createHmac, randomBytes } from 'node:crypto';

/** Authenticator codes (RFC 6238): HMAC-SHA1, 30-second steps, 6 digits, as every authenticator app uses. */
const STEP_SECONDS = 30;
const DIGITS = 6;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.replace(/[\s=]/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) throw new Error('Not base32');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new secret: 20 random bytes, written in base32 as authenticator apps expect. */
export const newTotpSecret = () => base32Encode(randomBytes(20));

export const totpStep = (at = Date.now()) => Math.floor(at / 1000 / STEP_SECONDS);

export function totpCode(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1]! & 15;
  const number = hmac.readUInt32BE(offset) & 0x7fffffff;
  return (number % 10 ** DIGITS).toString().padStart(DIGITS, '0');
}

/**
 * The step a code matches, allowing one step either side for a phone clock that is slightly off, or null.
 * Steps at or before `after` are refused, so a code that was already used can't be used again.
 */
export function matchTotp(secret: string, code: string, after: number | null, at = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const now = totpStep(at);
  for (const step of [now - 1, now, now + 1]) {
    if (after !== null && step <= after) continue;
    if (totpCode(secret, step) === code) return step;
  }
  return null;
}

/** What the QR code holds: authenticator apps read the issuer and the account name from it. */
export const otpauthUrl = (secret: string, email: string) =>
  `otpauth://totp/${encodeURIComponent(`Jiffo Admin:${email}`)}?secret=${secret}&issuer=${encodeURIComponent('Jiffo Admin')}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
