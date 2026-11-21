import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifySwitchSignature } from './switch-verify';

/** The app's check of the remote switch's signature (MB7), against one signed as the server signs it. */
describe('switch signature check', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const raw = new Uint8Array(publicKey.export({ format: 'der', type: 'spki' }).subarray(-32));
  const message = new TextEncoder().encode('{"pinning":"off"}');
  const signature = new Uint8Array(sign(null, message, privateKey));

  it("takes the server key's signature", () => {
    expect(verifySwitchSignature(message, signature, raw)).toBe(true);
  });

  it('refuses a changed message, another key, or a malformed signature, without throwing', () => {
    expect(verifySwitchSignature(new TextEncoder().encode('{"pinning":"on"}'), signature, raw)).toBe(false);
    const other = generateKeyPairSync('ed25519').publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
    expect(verifySwitchSignature(message, signature, new Uint8Array(other))).toBe(false);
    expect(verifySwitchSignature(message, new Uint8Array(10), raw)).toBe(false);
  });
});
