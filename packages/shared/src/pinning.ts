/**
 * The remote switch for certificate pinning (docs/security-plan.md, MB7). The server signs a short document with
 * its Ed25519 key, and the apps fetch it from a host they don't pin, so it still reaches them when a pin stops
 * matching. It can turn pinning off for a short while; nobody without the key can write one, and an old one sent
 * again changes nothing. See docs/security/pinning.md.
 */

export type PinningMode = 'on' | 'off';

export interface PinningSwitch {
  pinning: PinningMode;
  /** When the server signed it, ISO 8601: a phone takes only a switch newer than the last it took. */
  issuedAt: string;
  /** When an "off" ends, ISO 8601: pinning is on again after it, unless a newer switch says otherwise. */
  until?: string;
}

/** As the server publishes it: the switch as JSON text, and an Ed25519 signature over its UTF-8 bytes. */
export interface SignedPinningSwitch {
  payload: string;
  /** Base64. */
  signature: string;
}

/** The longest an "off" may last: long enough to ship an app with new pins, short enough not to linger. */
export const PINNING_OFF_MAX_MS = 7 * 24 * 3_600_000;
/**
 * How far ahead of the phone's clock a switch may be dated: a day, so a phone whose clock is hours slow still takes
 * an emergency "off" signed just now. Further ahead, it is a signing machine's clock gone wrong, and taking it would
 * block every later switch.
 */
export const PINNING_SWITCH_SKEW_MS = 24 * 3_600_000;

/** Checks an Ed25519 signature over a message with the server's switch key. */
export type SwitchVerifier = (message: Uint8Array, signature: Uint8Array) => boolean;

/** The text the server signs for a switch: its fields, always in the same order. */
export const switchPayload = (s: PinningSwitch) =>
  JSON.stringify(
    s.until === undefined
      ? { pinning: s.pinning, issuedAt: s.issuedAt }
      : { pinning: s.pinning, issuedAt: s.issuedAt, until: s.until },
  );

const fromBase64 = (text: string): Uint8Array | null => {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(text)) return null;
  try {
    return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
};

const isoTime = (value: unknown) => {
  if (typeof value !== 'string') return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
};

/**
 * A fetched switch, if the server's key signed it and it is one a phone may take: on, or off with an end in the
 * future no more than PINNING_OFF_MAX_MS after it was signed, and not dated ahead of the phone's clock.
 */
export function readSwitch(doc: unknown, verify: SwitchVerifier, now: number): PinningSwitch | null {
  if (!doc || typeof doc !== 'object') return null;
  const { payload, signature } = doc as Record<string, unknown>;
  if (typeof payload !== 'string' || typeof signature !== 'string') return null;
  const sig = fromBase64(signature);
  if (!sig || sig.length !== 64) return null;
  let signedOk = false;
  try {
    signedOk = verify(new TextEncoder().encode(payload), sig);
  } catch {
    signedOk = false;
  }
  if (!signedOk) return null;

  let fields: Record<string, unknown>;
  try {
    fields = JSON.parse(payload) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!fields || typeof fields !== 'object') return null;
  const issued = isoTime(fields.issuedAt);
  if (issued === null || issued > now + PINNING_SWITCH_SKEW_MS) return null;
  if (fields.pinning === 'on') return { pinning: 'on', issuedAt: fields.issuedAt as string };
  if (fields.pinning !== 'off') return null;
  const until = isoTime(fields.until);
  if (until === null || until <= now || until <= issued || until - issued > PINNING_OFF_MAX_MS) return null;
  return { pinning: 'off', issuedAt: fields.issuedAt as string, until: fields.until as string };
}

/** The switch to keep: the one received if it is newer than the one kept, otherwise the one kept. */
export function nextSwitch(kept: PinningSwitch | null, received: PinningSwitch | null): PinningSwitch | null {
  if (!received) return kept;
  if (kept && Date.parse(received.issuedAt) <= Date.parse(kept.issuedAt)) return kept;
  return received;
}

/** Whether the kept switch has pinning off now. */
export const pinningSwitchedOff = (kept: PinningSwitch | null, now: number) =>
  kept?.pinning === 'off' && kept.until !== undefined && now < Date.parse(kept.until);
