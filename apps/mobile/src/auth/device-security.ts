import { Platform } from 'react-native';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { deviceKeyAvailable, devicePublicKey, deviceSign } from '../../modules/device-key';
import { ApiError, type ApiClient } from '../api/client';
import { signedRequest } from './signing';

/** What the server knows about this phone and the person's PIN (GET /v1/me/security). */
export interface SecurityStatus {
  deviceKey: boolean;
  hasPin: boolean;
  pinLocked: boolean;
}

const sha256Hex = (text: string) =>
  Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, text, { encoding: Crypto.CryptoEncoding.HEX });

/** This build can sign money actions: a development or store build on a phone, not Expo Go or the web. */
export const canSign = () => Platform.OS !== 'web' && deviceKeyAvailable();

/**
 * Registers this phone's key, made in its secure hardware the first time (docs/security-plan.md, A3). Done
 * right after signing in to the agent app, since the server takes a key only in the first few minutes. The
 * same key again changes nothing; a new one, after a restore, pauses withdrawals on the server.
 */
export async function setUpPhone(api: ApiClient): Promise<'ready' | 'unsupported' | 'sign_in_again'> {
  if (!canSign()) return 'unsupported';
  try {
    await api.put('/v1/devices/current/key', { publicKey: await devicePublicKey() });
    return 'ready';
  } catch (error) {
    if (error instanceof ApiError && error.code === 'sign_in_again') return 'sign_in_again';
    throw error;
  }
}

/** A withdrawal or payout account change: signed by this phone's key, with the app PIN (A3, A7). */
export function moneyRequest<T>(api: ApiClient, method: 'POST' | 'PUT', path: string, body: unknown, pin: string) {
  return signedRequest<T>({ api, sign: deviceSign, sha256Hex }, method, path, body, pin);
}

/* The PIN, kept behind the phone's fingerprint or face so they can be used instead of typing it. */

const PIN_ITEM = 'jiffo.appPin';
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
export const rememberPin = (pin: string) => SecureStore.setItemAsync(PIN_ITEM, pin, LOCKED);

/** The PIN, after the fingerprint or face; null if none is kept, or the person cancels. */
export async function recallPin(): Promise<string | null> {
  if (!canUseBiometrics()) return null;
  try {
    return await SecureStore.getItemAsync(PIN_ITEM, LOCKED);
  } catch {
    return null;
  }
}

/** Forgets the kept PIN: after a change, or when the server says it's wrong. */
export const forgetPin = () => SecureStore.deleteItemAsync(PIN_ITEM, LOCKED).catch(() => undefined);
