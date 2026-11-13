import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

/**
 * Encrypts providers' keys before they are stored, with AES-256-GCM under a master key that lives only in
 * the API's environment (SECRETS_KEY). Each value is bound to the provider it belongs to, so a stored value
 * can't be moved onto another provider's row and still decrypt. The format carries a version, so the
 * scheme or the key can change later and older values still be read.
 */
export class SecretBox {
  private readonly key: Buffer;

  constructor(masterKeyHex: string) {
    const master = Buffer.from(masterKeyHex, 'hex');
    if (master.length !== 32) throw new Error('The secrets key must be 32 bytes, written as 64 hex characters');
    // Its own key for this purpose, so the master key could serve other uses without overlap.
    this.key = Buffer.from(hkdfSync('sha256', master, Buffer.alloc(0), 'jiffo provider secrets v1', 32));
  }

  seal(plaintext: string, binding: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(binding));
    const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return ['v1', iv.toString('base64'), tag.toString('base64'), body.toString('base64')].join('.');
  }

  /** Throws if the value was changed, sealed for another provider, or sealed under another key. */
  open(sealed: string, binding: string): string {
    const [version, iv, tag, body] = sealed.split('.');
    if (version !== 'v1' || !iv || !tag || body === undefined) throw new Error('Unknown secret format');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64'));
    decipher.setAAD(Buffer.from(binding));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(body, 'base64')), decipher.final()]).toString('utf8');
  }
}

/**
 * The master key: SECRETS_KEY, which production requires. In development and tests, without one, a key is
 * derived from JWT_SECRET so nothing extra has to be set up.
 */
export function secretsKeyFrom(env: { SECRETS_KEY?: string; JWT_SECRET: string }) {
  if (env.SECRETS_KEY) return env.SECRETS_KEY;
  return Buffer.from(
    hkdfSync('sha256', Buffer.from(env.JWT_SECRET), Buffer.alloc(0), 'jiffo development secrets key', 32),
  ).toString('hex');
}
