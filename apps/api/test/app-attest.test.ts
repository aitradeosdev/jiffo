import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyAssertion, verifyKeyAttestation, type AttestedKey } from '../src/attestation/app-attest';
import fixture from './fixtures/app-attest.json';

/*
 * The fixtures were made once with openssl, as Apple makes them: a root and an intermediate standing in for
 * Apple's, and for each environment a key whose certificate carries the nonce for one challenge.
 */

const sha256 = (...parts: Buffer[]) => {
  const h = createHash('sha256');
  for (const p of parts) h.update(p);
  return h.digest();
};
const APP_IDS = ['ABCDE12345.com.jiffoapp.customer', 'ABCDE12345.com.jiffoapp.agent'];
const attest = (
  env: 'development' | 'production',
  overrides: Partial<Parameters<typeof verifyKeyAttestation>[0]> = {},
) =>
  verifyKeyAttestation({
    attestation: Buffer.from(fixture[env].attestation, 'base64'),
    keyId: fixture[env].keyId,
    clientDataHash: Buffer.from(fixture[env].clientDataHash, 'hex'),
    appIds: APP_IDS,
    rootPem: fixture.root,
    ...overrides,
  });

describe('Apple App Attest: a new key (MB3)', () => {
  it('takes a key Apple attested for our challenge and app, and says which environment', () => {
    expect(attest('production')).toMatchObject({
      appId: 'ABCDE12345.com.jiffoapp.agent',
      counter: 0,
      development: false,
    });
    expect(attest('development')).toMatchObject({ development: true });
  });

  it("refuses one that isn't Apple's, or is for another challenge, key or app, or has expired", () => {
    // Our test root isn't Apple's: with Apple's own root, as in production, it's refused.
    expect(() => attest('production', { rootPem: undefined })).toThrow("Not Apple's");
    expect(() => attest('production', { clientDataHash: sha256(Buffer.from('another challenge')) })).toThrow(
      'For another challenge',
    );
    expect(() => attest('production', { keyId: fixture.development.keyId })).toThrow('For another key');
    expect(() => attest('production', { appIds: ['ABCDE12345.com.someone.else'] })).toThrow('For another app');
    expect(() => attest('production', { now: new Date('2200-01-01') })).toThrow('Certificate expired');
    expect(() => attest('production', { attestation: Buffer.from('not cbor') })).toThrow();
  });
});

describe('Apple App Attest: each request (MB3)', () => {
  // Each request is checked against the key kept from its attestation: one of our own stands in for it.
  const { privateKey: leafKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const key: AttestedKey = {
    appId: 'ABCDE12345.com.jiffoapp.agent',
    publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
    counter: 0,
    development: false,
  };
  const authData = (counter: number, appId = 'ABCDE12345.com.jiffoapp.agent') => {
    const c = Buffer.alloc(4);
    c.writeUInt32BE(counter);
    return Buffer.concat([sha256(Buffer.from(appId)), Buffer.from([0x40]), c]);
  };
  const cborBytes = (b: Buffer) => Buffer.concat([Buffer.from([0x58, b.length]), b]);
  const assertion = (data: Buffer, clientDataHash: Buffer, signer = leafKey) => {
    const signature = sign('sha256', sha256(data, clientDataHash), { key: signer, dsaEncoding: 'der' });
    // { "signature": bytes, "authenticatorData": bytes }
    return Buffer.concat([
      Buffer.from([0xa2, 0x69]),
      Buffer.from('signature'),
      cborBytes(signature),
      Buffer.from([0x71]),
      Buffer.from('authenticatorData'),
      cborBytes(data),
    ]);
  };
  const request = sha256(Buffer.from('POST /v1/wallet/withdrawals with this challenge'));

  it('takes a signature by the attested key over this request, and its counter', () => {
    expect(verifyAssertion({ assertion: assertion(authData(1), request), clientDataHash: request, ...key })).toBe(1);
  });

  it('refuses one used before, for another request or app, or by another key', () => {
    const once = assertion(authData(5), request);
    expect(verifyAssertion({ assertion: once, clientDataHash: request, ...key, counter: 4 })).toBe(5);
    expect(() => verifyAssertion({ assertion: once, clientDataHash: request, ...key, counter: 5 })).toThrow(
      'Used before',
    );
    expect(() =>
      verifyAssertion({ assertion: assertion(authData(6), request), clientDataHash: sha256(request), ...key }),
    ).toThrow('Not signed by this key');
    expect(() =>
      verifyAssertion({
        assertion: assertion(authData(6, 'ABCDE12345.com.someone.else'), request),
        clientDataHash: request,
        ...key,
      }),
    ).toThrow('For another app');
    const other = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey;
    expect(() =>
      verifyAssertion({ assertion: assertion(authData(6), request, other), clientDataHash: request, ...key }),
    ).toThrow('Not signed by this key');
  });
});
