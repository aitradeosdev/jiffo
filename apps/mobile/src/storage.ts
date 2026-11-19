import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

/**
 * Readable once the phone has been unlocked after starting, so the agent app can report its location with
 * the screen locked, and only on this phone (docs/security-plan.md, MB2): never in an iCloud or iTunes
 * backup, nor carried onto a new phone, where the person signs in again. Items saved under an earlier setting
 * keep it until they are next saved, which a token refresh does within the hour.
 */
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

/**
 * Small secrets (tokens, the device key): the keychain or keystore on phones. Web builds, for development
 * only, use localStorage; the API refuses their sign-in in production.
 */
export const secureStorage = {
  async get(key: string): Promise<string | null> {
    if (Platform.OS === 'web') {
      try {
        return globalThis.localStorage?.getItem(key) ?? null;
      } catch {
        return null;
      }
    }
    return SecureStore.getItemAsync(key, OPTIONS);
  },
  async set(key: string, value: string | null): Promise<void> {
    if (Platform.OS === 'web') {
      try {
        if (value === null) globalThis.localStorage?.removeItem(key);
        else globalThis.localStorage?.setItem(key, value);
      } catch {
        // Private browsing: the session lasts until the tab closes.
      }
      return;
    }
    if (value === null) await SecureStore.deleteItemAsync(key, OPTIONS);
    else await SecureStore.setItemAsync(key, value, OPTIONS);
  },
};
