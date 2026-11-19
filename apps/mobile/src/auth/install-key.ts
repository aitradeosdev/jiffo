import * as Crypto from 'expo-crypto';
import { VARIANT } from '../config';
import { secureStorage } from '../storage';

const DEVICE_KEY = `jiffo.${VARIANT}.device`;

/** A random id for this install, kept across sign-ins, so the server ties sessions and push to this phone. */
export async function deviceKey() {
  const existing = await secureStorage.get(DEVICE_KEY);
  if (existing) return existing;
  const key = Crypto.randomUUID();
  await secureStorage.set(DEVICE_KEY, key);
  return key;
}

/**
 * Saves this install's id again, which keeps it for this phone only from now on (docs/security-plan.md,
 * MB2): one saved by an earlier version would otherwise stay in backups, and a phone restored from one would
 * count as the same phone, without the new-phone hold or selfie. Tokens are saved again at each refresh.
 */
export async function keepDeviceKeyOnThisPhone() {
  const existing = await secureStorage.get(DEVICE_KEY);
  if (existing) await secureStorage.set(DEVICE_KEY, existing);
}
