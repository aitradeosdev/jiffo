import { nextSwitch, pinningSwitchedOff, readSwitch, type PinningSwitch } from '@jiffo/shared';

/** The build's pinning settings (app.config.ts, `pinningFor`). */
export interface PinningConfig {
  hosts: string[];
  pins: { ca: string; hash: string }[];
  expires: string;
  switchUrl: string;
  switchKey: string;
  /** When the build was made: a switch signed before it is ignored. */
  issuedAfter: string;
}

/** What each pinned host gets, as the pinning library and the WebSocket pinning take it. */
export type PinnedHosts = Record<
  string,
  { includeSubdomains: boolean; publicKeyHashes: string[]; expirationDate: string }
>;

export interface PinningDeps {
  /** Null in a build without pins. */
  config: PinningConfig | null;
  now: () => number;
  /** The switch document as JSON, or throws. */
  fetchSwitch: (url: string) => Promise<unknown>;
  /** An Ed25519 signature check with a raw 32-byte public key. */
  verify: (message: Uint8Array, signature: Uint8Array, publicKey: Uint8Array) => boolean;
  /** Where the last switch taken is kept between starts. */
  storage: { get: () => Promise<string | null>; set: (value: string) => Promise<void> };
  native: {
    /** Whether the native pinning is in this build (not in Expo Go or on the web). */
    available: () => boolean;
    pinRequests: (hosts: PinnedHosts) => Promise<void>;
    pinWebSockets: (hosts: PinnedHosts) => Promise<void>;
    /** Takes the request pins off, when the WebSockets couldn't get theirs. */
    unpinRequests: () => Promise<void>;
  };
}

/**
 * How pinning started:
 * - not_built: the build has no pins (it ships off);
 * - expired: the pins' end date has passed, so certificates are checked as normal;
 * - switched_off: a signed switch has it off for now;
 * - on: the hosts are pinned for requests and WebSockets;
 * - unavailable: the app can't pin here (Expo Go, the web);
 * - failed: the native side refused the pins, for requests or WebSockets, so both are checked as normal rather than
 *   locking people out.
 */
export type PinningState = 'not_built' | 'expired' | 'switched_off' | 'on' | 'unavailable' | 'failed';

const fromBase64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

const parseKept = (text: string | null): PinningSwitch | null => {
  if (!text) return null;
  try {
    const value = JSON.parse(text) as PinningSwitch;
    return value && (value.pinning === 'on' || value.pinning === 'off') && typeof value.issuedAt === 'string'
      ? value
      : null;
  } catch {
    return null;
  }
};

/**
 * Starts certificate pinning (docs/security/pinning.md, MB7), before the app's first request. The remote switch
 * is read first, and a newer one than the last taken is kept, so an "off" reaches a phone whose pins no longer
 * match. Nothing here ever stops the app: when pinning can't start, certificates are checked as normal.
 */
export async function startPinning(deps: PinningDeps): Promise<PinningState> {
  const { config } = deps;
  if (!config) return 'not_built';
  const now = deps.now();
  // The same end the native side uses: from the start of that day, UTC.
  if (now > Date.parse(`${config.expires}T00:00:00Z`)) return 'expired';

  // The build counts as a switch it took when it was made: one signed earlier, such as an old "off" replayed to a
  // new install, changes nothing.
  const built: PinningSwitch = { pinning: 'on', issuedAt: config.issuedAfter };
  const kept = nextSwitch(built, parseKept(await deps.storage.get().catch(() => null)));
  const key = fromBase64(config.switchKey);
  const received = await deps
    .fetchSwitch(config.switchUrl)
    .then((doc) => readSwitch(doc, (message, signature) => deps.verify(message, signature, key), now))
    .catch(() => null);
  const current = nextSwitch(kept, received);
  if (current && current !== kept && current !== built) {
    await deps.storage.set(JSON.stringify(current)).catch(() => undefined);
  }
  if (pinningSwitchedOff(current, now)) return 'switched_off';

  if (!deps.native.available()) return 'unavailable';
  const hosts: PinnedHosts = Object.fromEntries(
    config.hosts.map((host) => [
      host,
      { includeSubdomains: false, publicKeyHashes: config.pins.map((p) => p.hash), expirationDate: config.expires },
    ]),
  );
  try {
    await deps.native.pinRequests(hosts);
  } catch {
    return 'failed';
  }
  try {
    await deps.native.pinWebSockets(hosts);
    return 'on';
  } catch {
    // Requests and WebSockets are checked alike: both as usual, rather than the sign-in token's socket unpinned.
    await deps.native.unpinRequests().catch(() => undefined);
    return 'failed';
  }
}
