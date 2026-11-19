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
} as const;

/** What the phone does: hashes in and out as hex, Apple's answers as base64. */
export interface AttestNative {
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
  /** Where the iPhone keeps its attested key's id. */
  appleKey: { get(): Promise<string | null>; set(keyId: string | null): Promise<void> };
}

const challenge = (deps: AttestDeps, deviceKey: string) =>
  deps.api.public<{ nonce: string }>('POST', '/v1/attestation/challenge', { deviceKey });

/** The iPhone's attested key, made and registered with the server the first time. Null if it can't be. */
async function appleKeyId(deps: AttestDeps, native: AttestNative, deviceKey: string): Promise<string | null> {
  const kept = await deps.appleKey.get();
  if (kept) return kept;
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
  return keyId;
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
  try {
    const deviceKey = await deps.deviceKey();
    const keyId = deps.platform === 'ios' ? await appleKeyId(deps, native, deviceKey) : null;
    if (deps.platform === 'ios' && !keyId) return {};
    const { nonce } = await challenge(deps, deviceKey);
    const hash = await deps.sha256Hex(await signedPayload(nonce, method, path, JSON.stringify(body), deps.sha256Hex));
    if (keyId) {
      return {
        [ATTEST_HEADERS.nonce]: nonce,
        [ATTEST_HEADERS.token]: await native.appleAssertion(keyId, hash),
        [ATTEST_HEADERS.keyId]: keyId,
      };
    }
    return { [ATTEST_HEADERS.nonce]: nonce, [ATTEST_HEADERS.token]: await native.integrityToken(hash) };
  } catch {
    return {};
  }
}
