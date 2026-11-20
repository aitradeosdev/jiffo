import { generateKeyPairSync, sign, verify as nodeVerify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  nextSwitch,
  PINNING_OFF_MAX_MS,
  pinningSwitchedOff,
  readSwitch,
  switchPayload,
  type PinningSwitch,
} from '../src/pinning';

/**
 * The remote switch for certificate pinning (docs/security-plan.md, MB7): a document the server signs, which the
 * apps fetch from a host they don't pin. It can turn pinning off for a short while, so a pin that stops matching
 * doesn't lock people out, and nobody else can write one, or replay an old one.
 */
describe('the pinning switch', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const { privateKey: otherKey } = generateKeyPairSync('ed25519');
  const verify = (message: Uint8Array, signature: Uint8Array) => nodeVerify(null, message, publicKey, signature);
  const now = Date.parse('2026-11-20T12:00:00Z');
  const at = (ms: number) => new Date(now + ms).toISOString();
  const HOUR = 3_600_000;

  const signed = (s: PinningSwitch, key = privateKey) => {
    const payload = switchPayload(s);
    return { payload, signature: sign(null, Buffer.from(payload, 'utf8'), key).toString('base64') };
  };

  it('reads one the server signed', () => {
    const off = { pinning: 'off', issuedAt: at(-HOUR), until: at(47 * HOUR) } as const;
    expect(readSwitch(signed(off), verify, now)).toEqual(off);
    expect(readSwitch(signed({ pinning: 'on', issuedAt: at(0) }), verify, now)).toEqual({
      pinning: 'on',
      issuedAt: at(0),
    });
  });

  it('refuses one signed by any other key, or changed after signing', () => {
    const off = { pinning: 'off', issuedAt: at(0), until: at(HOUR) } as const;
    expect(readSwitch(signed(off, otherKey), verify, now)).toBeNull();
    const doc = signed({ pinning: 'on', issuedAt: at(0) });
    expect(readSwitch({ ...doc, payload: doc.payload.replace('"on"', '"off"') }, verify, now)).toBeNull();
    expect(readSwitch({ payload: doc.payload, signature: 'not base64!' }, verify, now)).toBeNull();
    expect(readSwitch(null, verify, now)).toBeNull();
    expect(readSwitch('{}', verify, now)).toBeNull();
  });

  it('turns pinning off only for a short while, with an end it names', () => {
    // No end, an end already past, or one further than allowed: refused.
    expect(readSwitch(signed({ pinning: 'off', issuedAt: at(0) }), verify, now)).toBeNull();
    expect(readSwitch(signed({ pinning: 'off', issuedAt: at(-3 * HOUR), until: at(-HOUR) }), verify, now)).toBeNull();
    expect(
      readSwitch(signed({ pinning: 'off', issuedAt: at(0), until: at(PINNING_OFF_MAX_MS + HOUR) }), verify, now),
    ).toBeNull();
    expect(
      readSwitch(signed({ pinning: 'off', issuedAt: at(0), until: at(PINNING_OFF_MAX_MS) }), verify, now),
    ).not.toBeNull();
  });

  it('refuses one dated in the future, beyond a phone clock being a little off', () => {
    expect(readSwitch(signed({ pinning: 'on', issuedAt: at(2 * HOUR) }), verify, now)).toBeNull();
    expect(readSwitch(signed({ pinning: 'on', issuedAt: at(5 * 60_000) }), verify, now)).not.toBeNull();
  });

  it('takes only a switch newer than the one kept, so an old one sent again changes nothing', () => {
    const offEarlier = { pinning: 'off', issuedAt: at(-2 * HOUR), until: at(40 * HOUR) } as const;
    const onLater = { pinning: 'on', issuedAt: at(-HOUR) } as const;
    expect(nextSwitch(null, offEarlier)).toEqual(offEarlier);
    expect(nextSwitch(offEarlier, onLater)).toEqual(onLater);
    // The earlier "off", replayed after the server turned pinning back on.
    expect(nextSwitch(onLater, offEarlier)).toEqual(onLater);
    expect(nextSwitch(onLater, onLater)).toEqual(onLater);
    // Nothing fetched: what was kept stands.
    expect(nextSwitch(onLater, null)).toEqual(onLater);
  });

  it('counts pinning as off only until the switch says, then on again', () => {
    const off = { pinning: 'off', issuedAt: at(-HOUR), until: at(HOUR) } as const;
    expect(pinningSwitchedOff(off, now)).toBe(true);
    expect(pinningSwitchedOff(off, now + 2 * HOUR)).toBe(false);
    expect(pinningSwitchedOff({ pinning: 'on', issuedAt: at(0) }, now)).toBe(false);
    expect(pinningSwitchedOff(null, now)).toBe(false);
  });
});
