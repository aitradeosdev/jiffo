import Constants from 'expo-constants';
import { disableSslPinning, initializeSslPinning, isSslPinningAvailable } from 'react-native-ssl-public-key-pinning';
import { pinWebSockets, socketPinningAvailable } from '../../modules/socket-pinning';
import { VARIANT } from '../config';
import { secureStorage } from '../storage';
import { startPinning, type PinningConfig, type PinningState } from './pinning-core';
import { verifySwitchSignature } from './switch-verify';

/** How long the app waits for the remote switch before going on with what it kept. */
const SWITCH_TIMEOUT_MS = 3_000;
const KEPT_SWITCH = `jiffo.${VARIANT}.pinningSwitch`;

const config = ((Constants.expoConfig?.extra ?? {}) as { pinning?: PinningConfig | null }).pinning ?? null;

async function fetchSwitch(url: string): Promise<unknown> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), SWITCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: abort.signal, headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`The switch answered ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

let started: Promise<PinningState> | null = null;

/**
 * Certificate pinning (docs/security/pinning.md, MB7), started once, before the app's first request: what the
 * build's settings and the remote switch say. Off in a build without pins, which is how it ships.
 */
export function pinningReady(): Promise<PinningState> {
  started ??= startPinning({
    config,
    now: Date.now,
    fetchSwitch,
    verify: verifySwitchSignature,
    storage: { get: () => secureStorage.get(KEPT_SWITCH), set: (value) => secureStorage.set(KEPT_SWITCH, value) },
    native: {
      available: () => isSslPinningAvailable() && socketPinningAvailable(),
      pinRequests: (hosts) => initializeSslPinning(hosts),
      pinWebSockets,
      unpinRequests: disableSslPinning,
    },
  }).catch((): PinningState => 'failed');
  return started;
}

/** fetch, once pinning has started: the API clients send every request through it. */
export const pinnedFetch: typeof fetch = async (input, init) => {
  await pinningReady();
  return fetch(input, init);
};
