/**
 * App checks (docs/security-plan.md, MB3): Google Play Integrity on Android and Apple App Attest on iOS, over
 * a single-use code from the server, covering the request as a signed money request does. Plain TypeScript,
 * so it runs in tests without React Native; the phone's part is modules/app-attest.
 */
import type { ApiClient } from '../api/client';
import { signedPayload } from './signing';

/** The headers a checked request carries, as the API reads them (apps/api/src/attestation). */
export const ATTEST_HEADERS = {
  nonce: 'x-jiffo-attest-nonce',
  token: 'x-jiffo-attest',
  keyId: 'x-jiffo-attest-key',
  /** What the app found on the phone (MB4), comma-separated. */
  risk: 'x-jiffo-risk',
} as const;

/** What the phone does: hashes in and out as hex, Apple's answers as base64. */
export interface AttestNative {
  /** Whether this build can make a check at all (Android needs its Google Cloud project number). */
  ready?(): boolean;
  /** Gets ready ahead of the first check (Play Integrity's token provider). */
  prepare?(): void;
  /** What the app finds on the phone (MB4): rooted, emulator, hooking, debugger. */
  riskSignals?(): Promise<string[]>;
  /** Android: a Play Integrity token over the request's hash. */
  integrityToken(requestHash: string): Promise<string>;
  /** iOS: a new App Attest key in the Secure Enclave; its id. */
  newAppleKey(): Promise<string>;
  /** iOS: Apple's attestation of the key, over the hash of the server's code. Once per key. */
  attestAppleKey(keyId: string, clientDataHash: string): Promise<string>;
  /** iOS: the key's assertion over the request's hash. */
  appleAssertion(keyId: string, clientDataHash: string): Promise<string>;
}

export interface AttestDeps {
  api: Pick<ApiClient, 'public'>;
  /** Absent in Expo Go and on the web, where no check can be made. */
  native: AttestNative | null;
  platform: 'ios' | 'android' | 'web';
  app: 'customer' | 'agent';
  /** This install's key, which names it to the server. */
  deviceKey: () => Promise<string>;
  sha256Hex: (text: string) => Promise<string>;
  /** Where the iPhone keeps its attested key's id, and until when not to try making one again. */
  appleKey: {
    get(): Promise<string | null>;
    set(keyId: string | null): Promise<void>;
    holdUntil(): Promise<number | null>;
    hold(until: number | null): Promise<void>;
  };
  now?: () => number;
}

/** After the server didn't take a new key (not set up for iPhones yet, say), this long before another. */
const KEY_RETRY_MS = 6 * 3_600_000;

const challenge = (deps: AttestDeps, deviceKey: string) =>
  deps.api.public<{ nonce: string }>('POST', '/v1/attestation/challenge', { deviceKey });

/**
 * The iPhone's attested key, made and registered with the server the first time. Null if it can't be: then
 * not tried again for a while, since each try is a new key and a call to Apple.
 */
async function appleKeyId(deps: AttestDeps, native: AttestNative, deviceKey: string): Promise<string | null> {
  const kept = await deps.appleKey.get();
  if (kept) return kept;
  const now = (deps.now ?? Date.now)();
  const until = await deps.appleKey.holdUntil();
  if (until && now < until) return null;
  try {
    return await registerAppleKey(deps, native, deviceKey);
  } catch {
    await deps.appleKey.hold(now + KEY_RETRY_MS);
    return null;
  }
}

async function registerAppleKey(deps: AttestDeps, native: AttestNative, deviceKey: string) {
  const keyId = await native.newAppleKey();
  const { nonce } = await challenge(deps, deviceKey);
  const attestation = await native.attestAppleKey(keyId, await deps.sha256Hex(nonce));
  await deps.api.public('POST', '/v1/attestation/apple-key', {
    deviceKey,
    app: deps.app,
    keyId,
    attestation,
    nonce,
  });
  // Kept only once the server has it: Apple attests a key once, so a key the server never saw is dropped.
  await deps.appleKey.set(keyId);
  await deps.appleKey.hold(null);
  return keyId;
}

/** The kept key's assertion; if the key stopped working (the app was reinstalled), a new key's, once. */
async function appleAssertion(deps: AttestDeps, native: AttestNative, deviceKey: string, hash: string) {
  const keyId = await appleKeyId(deps, native, deviceKey);
  if (!keyId) return null;
  try {
    return { keyId, assertion: await native.appleAssertion(keyId, hash) };
  } catch {
    await deps.appleKey.set(null);
    const fresh = await appleKeyId(deps, native, deviceKey);
    return fresh ? { keyId: fresh, assertion: await native.appleAssertion(fresh, hash) } : null;
  }
}

/**
 * The check's headers for a request, made for its method, path and body. Empty when no check can be made:
 * the server then decides, recording it or saying the store app is needed.
 */
export async function attestationHeaders(
  deps: AttestDeps,
  method: 'POST' | 'PUT',
  path: string,
  body: unknown,
): Promise<Record<string, string>> {
  const native = deps.native;
  if (!native || deps.platform === 'web') return {};
  // Sent whether or not a check can be made: the app's own word, which adds to Google's and Apple's. A build
  // that can't look for them sends none.
  let signals: string[] = [];
  try {
    signals = (await native.riskSignals?.()) ?? [];
  } catch {
    signals = [];
  }
  const risk = [...new Set(signals)].sort().join(',');
  return {
    ...(risk ? { [ATTEST_HEADERS.risk]: risk } : {}),
    ...(await check(deps, native, method, path, body, risk)),
  };
}

async function check(
  deps: AttestDeps,
  native: AttestNative,
  method: 'POST' | 'PUT',
  path: string,
  body: unknown,
  /** The risk header as sent, which the check covers, as the server hashes it. */
  risk: string,
): Promise<Record<string, string>> {
  if (native.ready?.() === false) return {};
  try {
    const deviceKey = await deps.deviceKey();
    // An iPhone needs its key first; without one, no code is asked for.
    if (deps.platform === 'ios' && !(await appleKeyId(deps, native, deviceKey))) return {};
    const { nonce } = await challenge(deps, deviceKey);
    const payload = await signedPayload(nonce, method, path, JSON.stringify(body), deps.sha256Hex);
    const hash = await deps.sha256Hex(`${payload}\nrisk:${risk}`);
    if (deps.platform === 'ios') {
      const signed = await appleAssertion(deps, native, deviceKey, hash);
      if (!signed) return {};
      return {
        [ATTEST_HEADERS.nonce]: nonce,
        [ATTEST_HEADERS.token]: signed.assertion,
        [ATTEST_HEADERS.keyId]: signed.keyId,
      };
    }
    return { [ATTEST_HEADERS.nonce]: nonce, [ATTEST_HEADERS.token]: await native.integrityToken(hash) };
  } catch {
    return {};
  }
}
