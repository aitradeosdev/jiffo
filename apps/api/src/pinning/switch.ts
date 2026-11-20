import { createPrivateKey, generateKeyPairSync, sign } from 'node:crypto';
import { PINNING_OFF_MAX_MS, switchPayload, type PinningSwitch, type SignedPinningSwitch } from '@jiffo/shared';

const HOUR_MS = 3_600_000;
const MAX_OFF_HOURS = PINNING_OFF_MAX_MS / HOUR_MS;

/**
 * A key pair for the remote pinning switch (docs/security-plan.md, MB7): the raw Ed25519 public key, base64, for
 * the app builds' PINNING_SWITCH_KEY, and the private key (PKCS#8, base64) to keep as a secret.
 */
export function newSwitchKeys() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  // An Ed25519 SubjectPublicKeyInfo ends with the 32-byte key.
  const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  return {
    publicKey: raw.toString('base64'),
    privateKey: privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
  };
}

/**
 * A switch signed with the private key, as the apps fetch it: pinning on, or off for a number of hours (up to a
 * week), dated now. Each one is newer than the last, so the apps take it over an earlier one.
 */
export function signSwitch(
  privateKey: string,
  ask: { pinning: 'on' } | { pinning: 'off'; hours?: number },
  now = Date.now(),
): SignedPinningSwitch {
  let key;
  try {
    key = createPrivateKey({ key: Buffer.from(privateKey, 'base64'), format: 'der', type: 'pkcs8' });
  } catch {
    throw new Error('PINNING_SWITCH_PRIVATE_KEY must be the private key `keygen` printed');
  }
  if (key.asymmetricKeyType !== 'ed25519') {
    throw new Error('PINNING_SWITCH_PRIVATE_KEY must be the private key `keygen` printed');
  }
  const issuedAt = new Date(now).toISOString();
  let doc: PinningSwitch = { pinning: 'on', issuedAt };
  if (ask.pinning === 'off') {
    const hours = ask.hours;
    if (hours === undefined || !Number.isFinite(hours) || hours <= 0 || hours > MAX_OFF_HOURS) {
      throw new Error(`Turning pinning off needs --hours, from 1 to ${MAX_OFF_HOURS}`);
    }
    doc = { pinning: 'off', issuedAt, until: new Date(now + hours * HOUR_MS).toISOString() };
  }
  const payload = switchPayload(doc);
  return { payload, signature: sign(null, Buffer.from(payload, 'utf8'), key).toString('base64') };
}
