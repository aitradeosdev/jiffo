import { Platform } from 'react-native';
import { appAttest } from '../../modules/app-attest';
import { API_URL, VARIANT } from '../config';
import { secureStorage } from '../storage';
import { createApiClient } from '../api/client';
import { attestationHeaders, type AttestDeps } from './attestation';
import { sha256Hex } from './hash';
import { deviceKey } from './install-key';

const APPLE_KEY = `jiffo.${VARIANT}.appAttestKey`;
const APPLE_KEY_HOLD = `jiffo.${VARIANT}.appAttestKeyHold`;

/** The two app-check routes are public: they come before sign-in too. */
const publicApi = createApiClient({
  baseUrl: API_URL,
  store: { get: async () => null, set: async () => undefined },
});

const deps: AttestDeps = {
  api: publicApi,
  native: appAttest,
  platform: Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web',
  app: VARIANT,
  deviceKey,
  sha256Hex,
  appleKey: {
    get: () => secureStorage.get(APPLE_KEY),
    set: (keyId) => secureStorage.set(APPLE_KEY, keyId),
    holdUntil: async () => Number(await secureStorage.get(APPLE_KEY_HOLD)) || null,
    hold: (until) => secureStorage.set(APPLE_KEY_HOLD, until ? String(until) : null),
  },
};

// Play Integrity prepares its token provider ahead, so the first check doesn't wait on it.
appAttest?.prepare?.();

/**
 * The app check's headers for a request (docs/security-plan.md, MB3): sign-in, money actions and going
 * online. Empty where the phone can't make one (Expo Go, the web); the server then decides.
 */
export const appCheck = (method: 'POST' | 'PUT', path: string, body: unknown) =>
  attestationHeaders(deps, method, path, body);
