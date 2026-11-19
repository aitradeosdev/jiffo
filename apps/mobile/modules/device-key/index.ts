import { requireOptionalNativeModule } from 'expo';

/**
 * The phone's own signing key (docs/security-plan.md, A3), made in the Secure Enclave or Android Keystore by
 * the native module beside this file. Absent in Expo Go and on the web, where money actions can't be signed.
 */
interface DeviceKeyNative {
  publicKey(alias: string): Promise<string>;
  sign(alias: string, text: string): Promise<string>;
  remove(alias: string): Promise<void>;
}

const native = requireOptionalNativeModule<DeviceKeyNative>('DeviceKey');

/** The key's name on this phone. One key per install of the app. */
const ALIAS = 'money';

export const deviceKeyAvailable = () => native !== null;

/** The public half as base64 SPKI, making the key the first time. */
export function devicePublicKey(): Promise<string> {
  if (!native) throw new Error("This build can't sign money actions");
  return native.publicKey(ALIAS);
}

/** Deletes the key from this phone: after signing out and forgetting the phone, a fresh one is made next time. */
export async function deviceKeyRemove(): Promise<void> {
  if (native) await native.remove(ALIAS);
}

/** An ECDSA P-256 SHA-256 signature over the text, as base64 DER. */
export function deviceSign(text: string): Promise<string> {
  if (!native) throw new Error("This build can't sign money actions");
  return native.sign(ALIAS, text);
}
