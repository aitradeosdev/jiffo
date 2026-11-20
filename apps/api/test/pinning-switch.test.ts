import { createPublicKey, verify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { PINNING_OFF_MAX_MS, readSwitch } from '@jiffo/shared';
import { newSwitchKeys, signSwitch } from '../src/pinning/switch';

/**
 * The server's side of the remote pinning switch (docs/security-plan.md, MB7): its key pair, and the signed
 * documents published for the apps to fetch. Read back here as the apps read them.
 */
describe('pinning switch signing', () => {
  /** The apps' check: the raw public key from the build setting, as an Ed25519 key. */
  const verifierFor = (rawPublicKey: string) => {
    const key = createPublicKey({
      key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(rawPublicKey, 'base64')]),
      format: 'der',
      type: 'spki',
    });
    return (message: Uint8Array, signature: Uint8Array) => verify(null, message, key, signature);
  };
  const now = Date.parse('2026-11-20T12:00:00Z');

  it('makes a key pair: the public half for the app builds, the private half to keep', () => {
    const keys = newSwitchKeys();
    expect(Buffer.from(keys.publicKey, 'base64')).toHaveLength(32);
    expect(keys.privateKey).not.toContain(keys.publicKey);
  });

  it('signs a switch the apps take: off until a set time, or on', () => {
    const keys = newSwitchKeys();
    const off = signSwitch(keys.privateKey, { pinning: 'off', hours: 48 }, now);
    expect(readSwitch(off, verifierFor(keys.publicKey), now)).toEqual({
      pinning: 'off',
      issuedAt: new Date(now).toISOString(),
      until: new Date(now + 48 * 3_600_000).toISOString(),
    });
    const on = signSwitch(keys.privateKey, { pinning: 'on' }, now + 1000);
    expect(readSwitch(on, verifierFor(keys.publicKey), now + 1000)).toMatchObject({ pinning: 'on' });
    // Another key's apps don't take it.
    expect(readSwitch(on, verifierFor(newSwitchKeys().publicKey), now + 1000)).toBeNull();
  });

  it('refuses an off with no end, or longer than the apps take', () => {
    const keys = newSwitchKeys();
    expect(() => signSwitch(keys.privateKey, { pinning: 'off' }, now)).toThrow(/hours/);
    expect(() =>
      signSwitch(keys.privateKey, { pinning: 'off', hours: PINNING_OFF_MAX_MS / 3_600_000 + 1 }, now),
    ).toThrow(/hours/);
    expect(() => signSwitch('not a key', { pinning: 'on' }, now)).toThrow(/PINNING_SWITCH_PRIVATE_KEY/);
  });
});
