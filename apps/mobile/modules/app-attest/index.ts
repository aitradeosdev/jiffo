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
