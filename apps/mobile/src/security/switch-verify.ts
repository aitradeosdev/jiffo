import { ed25519 } from '@noble/curves/ed25519.js';

/**
 * Checks the remote pinning switch's Ed25519 signature with the server's raw public key (MB7). In JavaScript, as
 * the phone's own crypto offers no Ed25519 everywhere. A malformed signature or key is a failed check.
 */
export function verifySwitchSignature(message: Uint8Array, signature: Uint8Array, publicKey: Uint8Array): boolean {
  try {
    return ed25519.verify(signature, message, publicKey);
  } catch {
    return false;
  }
}
