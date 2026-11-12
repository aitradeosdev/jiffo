import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from 'node:crypto';

export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

export const hmacSha256 = (secret: string, value: string) => createHmac('sha256', secret).update(value).digest('hex');

/** Compares two strings in constant time, so a wrong guess takes as long as a right one. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** A numeric code with leading zeros kept, e.g. "004217". */
export const numericCode = (digits: number) =>
  randomInt(0, 10 ** digits)
    .toString()
    .padStart(digits, '0');

export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

/** AES-256-GCM. The output is iv.tag.ciphertext, each base64url. Used for hand-off PINs the customer must be able to see. */
export function encrypt(keyHex: string, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), iv);
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map((b) => b.toString('base64url')).join('.');
}

export function decrypt(keyHex: string, sealed: string): string {
  const [iv, tag, body] = sealed.split('.').map((part) => Buffer.from(part, 'base64url'));
  if (!iv || !tag || !body) throw new Error('Malformed ciphertext');
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
}
