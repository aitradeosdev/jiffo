import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';
import Constants from 'expo-constants';
import type { AttestNative } from '@/auth/attestation';

/**
 * App checks on the phone (docs/security-plan.md, MB3), by the native module beside this file: Play
 * Integrity on Android, App Attest on iOS. Absent in Expo Go and on the web, where no check can be made.
 */
interface AppAttestNative {
  riskSignals(): Promise<string[]>;
  prepareIntegrity(cloudProjectNumber: string): Promise<void>;
  integrityToken(requestHash: string, cloudProjectNumber: string): Promise<string>;
  newAppleKey(): Promise<string>;
  attestAppleKey(keyId: string, clientDataHash: string): Promise<string>;
  appleAssertion(keyId: string, clientDataHash: string): Promise<string>;
  phoneId?(): Promise<string | null>;
}

const native = requireOptionalNativeModule<AppAttestNative>('AppAttest');

/** The Google Cloud project linked to the app in Play Console, which Play Integrity's tokens are for. */
const cloudProjectNumber = String(Constants.expoConfig?.extra?.playCloudProjectNumber ?? '');

export const appAttest: AttestNative | null = native
  ? {
      // Android can't ask Play Integrity without the project; iOS needs nothing more.
      ready: () => Platform.OS !== 'android' || cloudProjectNumber !== '',
      prepare: () => {
        if (Platform.OS === 'android' && cloudProjectNumber) {
          native.prepareIntegrity(cloudProjectNumber).catch(() => undefined);
        }
      },
      riskSignals: () => native.riskSignals(),
      integrityToken: (requestHash) => native.integrityToken(requestHash, cloudProjectNumber),
      newAppleKey: () => native.newAppleKey(),
      attestAppleKey: (keyId, hash) => native.attestAppleKey(keyId, hash),
      appleAssertion: (keyId, hash) => native.appleAssertion(keyId, hash),
    }
  : null;

/**
 * The phone's own id, the same in both Jiffo apps on one phone (docs/security-plan.md, I3, E6): iOS's id for
 * the vendor, Android's id for apps signed with one key. Sent at sign-in, so accounts sharing a phone can be
 * flagged; the server keeps only a keyed hash. Null on the web, in Expo Go, or from a build without it.
 */
export async function phoneId(): Promise<string | null> {
  try {
    return (await native?.phoneId?.()) ?? null;
  } catch {
    return null;
  }
}
