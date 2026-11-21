import { createPrivateKey, generateKeyPairSync, sign } from 'node:crypto';
import { parseArgs } from 'node:util';
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
    if (hours === undefined || !Number.isInteger(hours) || hours < 1 || hours > MAX_OFF_HOURS) {
      throw new Error(`Turning pinning off needs --hours, from 1 to ${MAX_OFF_HOURS}`);
    }
    doc = { pinning: 'off', issuedAt, until: new Date(now + hours * HOUR_MS).toISOString() };
  }
  const payload = switchPayload(doc);
  return { payload, signature: sign(null, Buffer.from(payload, 'utf8'), key).toString('base64') };
}

export const SWITCH_USAGE = `The remote switch for the apps' certificate pinning (docs/security/pinning.md).

  keygen
      Makes the switch's key pair. PINNING_SWITCH_KEY goes in the app builds' settings; keep
      PINNING_SWITCH_PRIVATE_KEY as a secret, where only those who may switch pinning off can reach it.

  sign --off --hours <1-${MAX_OFF_HOURS}> --out <file>
      Turns pinning off for that many whole hours, from now, and writes the document to the file. Upload it
      to the switch address the apps fetch (PINNING_SWITCH_URL), in place of the one there.

  sign --on --out <file>
      Turns pinning back on before an "off" ends.

  sign reads the private key from PINNING_SWITCH_PRIVATE_KEY.
`;

/**
 * The pinning-switch command, without touching the disk or the terminal: what to print, the file to write, and
 * the exit code. The document goes to its own file, never printed, so nothing printed around it (pnpm's own
 * lines) can end up in what's uploaded.
 */
export function switchCommand(
  argv: string[],
  env: Record<string, string | undefined>,
  now = Date.now(),
): { out: string; file?: { path: string; text: string }; code: number } {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        on: { type: 'boolean' },
        off: { type: 'boolean' },
        hours: { type: 'string' },
        out: { type: 'string' },
      },
    });
  } catch (error) {
    return { out: `${(error as Error).message}\n\n${SWITCH_USAGE}`, code: 1 };
  }
  const { positionals, values } = parsed;
  const command = positionals[0];
  if (command === 'keygen') {
    const keys = newSwitchKeys();
    return { out: `PINNING_SWITCH_KEY=${keys.publicKey}\nPINNING_SWITCH_PRIVATE_KEY=${keys.privateKey}\n`, code: 0 };
  }
  if (command === 'sign' && !!values.on !== !!values.off && values.out) {
    // Whole hours only: "0.5" or "1e2" is a typo more often than a wish.
    if (values.off && !/^\d+$/.test(values.hours ?? '')) {
      return { out: `Turning pinning off needs --hours, a whole number from 1 to ${MAX_OFF_HOURS}\n`, code: 1 };
    }
    try {
      const doc = values.on
        ? signSwitch(env.PINNING_SWITCH_PRIVATE_KEY ?? '', { pinning: 'on' }, now)
        : signSwitch(env.PINNING_SWITCH_PRIVATE_KEY ?? '', { pinning: 'off', hours: Number(values.hours) }, now);
      return {
        out: `Wrote ${values.out}: upload it to PINNING_SWITCH_URL.\n`,
        file: { path: values.out, text: `${JSON.stringify(doc)}\n` },
        code: 0,
      };
    } catch (error) {
      return { out: `${(error as Error).message}\n`, code: 1 };
    }
  }
  return { out: SWITCH_USAGE, code: command ? 1 : 0 };
}
