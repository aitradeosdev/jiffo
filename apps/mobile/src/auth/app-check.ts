import { Platform } from 'react-native';
import { appAttest } from '../../modules/app-attest';
import { API_URL, VARIANT } from '../config';
import { secureStorage } from '../storage';
import { createApiClient } from '../api/client';
import { attestationHeaders, type AttestDeps } from './attestation';
import { sha256Hex } from './hash';
import { deviceKey } from './install-key';

const APPLE_KEY = `jiffo.${VARIANT}.appAttestKey`;

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
  appleKey: { get: () => secureStorage.get(APPLE_KEY), set: (keyId) => secureStorage.set(APPLE_KEY, keyId) },
};

/**
 * The app check's headers for a request (docs/security-plan.md, MB3): sign-in, money actions and going
 * online. Empty where the phone can't make one (Expo Go, the web); the server then decides.
 */
export const appCheck = (method: 'POST' | 'PUT', path: string, body: unknown) =>
  attestationHeaders(deps, method, path, body);
