import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { deviceKeyAvailable, devicePublicKey, deviceSign } from '../../modules/device-key';
import { ApiError, type ApiClient } from '../api/client';
import { appCheck } from './app-check';
import { sha256Hex } from './hash';
import { signedRequest } from './signing';

/** What the server knows about this phone and the person's PIN (GET /v1/me/security). */
export interface SecurityStatus {
  deviceKey: boolean;
  hasPin: boolean;
  pinLocked: boolean;
}

/** This build can sign money actions: a development or store build on a phone, not Expo Go or the web. */
export const canSign = () => Platform.OS !== 'web' && deviceKeyAvailable();

/**
 * Registers this phone's key, made in its secure hardware the first time (docs/security-plan.md, A3). Done
 * right after signing in to the agent app, since the server takes a key only in the first few minutes. The
 * same key again changes nothing; a new one, after a restore, pauses withdrawals on the server.
 */
let settingUp: Promise<'ready' | 'unsupported' | 'sign_in_again'> | null = null;

export function setUpPhone(api: ApiClient): Promise<'ready' | 'unsupported' | 'sign_in_again'> {
  // One at a time: sign-in and a money screen asking together would otherwise race to make the key.
  settingUp ??= (async () => {
    if (!canSign()) return 'unsupported' as const;
    try {
      await api.put('/v1/devices/current/key', { publicKey: await devicePublicKey() });
      return 'ready' as const;
    } catch (error) {
      if (error instanceof ApiError && error.code === 'sign_in_again') return 'sign_in_again' as const;
      throw error;
    }
  })().finally(() => {
    settingUp = null;
  });
  return settingUp;
}

/** Money actions the server also asks the app check for (MB3). */
const CHECKED = new Set(['/v1/wallet/withdrawals', '/v1/payout-account']);

/**
 * A withdrawal or payout account change: signed by this phone's key, with the app PIN (A3, A7), and with the
 * app check where the server asks for it (MB3), made fresh for each attempt.
 */
export function moneyRequest<T>(api: ApiClient, method: 'POST' | 'PUT', path: string, body: unknown, pin: string) {
  return signedRequest<T>(
    { api, sign: deviceSign, sha256Hex, ...(CHECKED.has(path) ? { attest: appCheck } : {}) },
    method,
    path,
    body,
    pin,
  );
}

/*
 * The PIN, kept behind the phone's fingerprint or face so they can be used instead of typing it. Kept per
 * person, and forgotten when they sign out: another agent on the same phone never gets it.
 */

const pinItem = (userId: string) => `jiffo.appPin.${userId}`;
const LOCKED: SecureStore.SecureStoreOptions = {
  requireAuthentication: true,
  // Only on this phone, only while it has a screen lock: never in a backup or on another phone.
  keychainAccessible: SecureStore.WHEN_PASSCODE_SET_THIS_DEVICE_ONLY,
  authenticationPrompt: 'Confirm with your fingerprint or face',
};

/** The phone has a fingerprint or face set up, so the PIN can be filled in with it. */
export const canUseBiometrics = () => {
  try {
    return Platform.OS !== 'web' && SecureStore.canUseBiometricAuthentication();
  } catch {
    return false;
  }
};

/** Keeps the PIN behind the fingerprint or face. */
export const rememberPin = (userId: string, pin: string) => SecureStore.setItemAsync(pinItem(userId), pin, LOCKED);

/** The PIN, after the fingerprint or face; null if none is kept, or the person cancels. */
export async function recallPin(userId: string): Promise<string | null> {
  if (!canUseBiometrics()) return null;
  try {
    return await SecureStore.getItemAsync(pinItem(userId), LOCKED);
  } catch {
    return null;
  }
}

/** Forgets the kept PIN: when they turn it off, sign out, or the server says it's no longer right. */
export const forgetPin = (userId: string) =>
  SecureStore.deleteItemAsync(pinItem(userId), LOCKED).catch(() => undefined);
