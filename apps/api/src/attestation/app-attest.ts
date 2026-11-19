import { createHash, createPublicKey, verify, X509Certificate } from 'node:crypto';
import { decodeCbor, type Cbor } from './cbor';

/**
 * Apple App Attest, checked on the server as Apple describes in "Validating apps that connect to your
 * server" (docs/security-plan.md, MB3). An app makes a key in the Secure Enclave and has Apple attest it once;
 * after that each request carries an assertion: a signature by that key over the request.
 */

/** Apple's App Attestation Root CA (https://www.apple.com/certificateauthority/), valid to 2045. */
export const APPLE_APP_ATTEST_ROOT = `-----BEGIN CERTIFICATE-----
MIICITCCAaegAwIBAgIQC/O+DvHN0uD7jG5yH2IXmDAKBggqhkjOPQQDAzBSMSYw
JAYDVQQDDB1BcHBsZSBBcHAgQXR0ZXN0YXRpb24gUm9vdCBDQTETMBEGA1UECgwK
QXBwbGUgSW5jLjETMBEGA1UECAwKQ2FsaWZvcm5pYTAeFw0yMDAzMTgxODMyNTNa
Fw00NTAzMTUwMDAwMDBaMFIxJjAkBgNVBAMMHUFwcGxlIEFwcCBBdHRlc3RhdGlv
biBSb290IENBMRMwEQYDVQQKDApBcHBsZSBJbmMuMRMwEQYDVQQIDApDYWxpZm9y
bmlhMHYwEAYHKoZIzj0CAQYFK4EEACIDYgAERTHhmLW07ATaFQIEVwTtT4dyctdh
NbJhFs/Ii2FdCgAHGbpphY3+d8qjuDngIN3WVhQUBHAoMeQ/cLiP1sOUtgjqK9au
Yen1mMEvRq9Sk3Jm5X8U62H+xTD3FE9TgS41o0IwQDAPBgNVHRMBAf8EBTADAQH/
MB0GA1UdDgQWBBSskRBTM72+aEH/pwyp5frq5eWKoTAOBgNVHQ8BAf8EBAMCAQYw
CgYIKoZIzj0EAwMDaAAwZQIwQgFGnByvsiVbpTKwSga0kP0e8EeDS4+sQmTvb7vn
53O5+FRXgeLhpJ06ysC5PrOyAjEAp5U4xDgEgllF7En3VcE3iexZZtKeYnpqtijV
oyFraWVIyd/dganmrduC1bmTBGwD
-----END CERTIFICATE-----`;

/** Where Apple puts the attestation's nonce in the key's certificate. */
const NONCE_OID = Buffer.from([0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x63, 0x64, 0x08, 0x02]);
const AAGUID_PRODUCTION = Buffer.concat([Buffer.from('appattest'), Buffer.alloc(7)]);
const AAGUID_DEVELOPMENT = Buffer.from('appattestdevelop');

export class AppAttestError extends Error {}

const sha256 = (...parts: Buffer[]) => {
  const h = createHash('sha256');
  for (const p of parts) h.update(p);
  return h.digest();
};

const field = (map: Cbor, key: string): Cbor | undefined => (map instanceof Map ? map.get(key) : undefined);
const bytes = (value: Cbor | undefined, what: string): Buffer => {
  if (!Buffer.isBuffer(value)) throw new AppAttestError(`No ${what}`);
  return value;
};

/** A DER element's length and where its content starts. */
function derLength(der: Buffer, at: number): { length: number; start: number } {
  const first = der[at];
  if (first === undefined) throw new AppAttestError('Certificate ends early');
  if (first < 0x80) return { length: first, start: at + 1 };
  const n = first & 0x7f;
  if (n < 1 || n > 4) throw new AppAttestError('Bad length in certificate');
  let length = 0;
  for (let i = 1; i <= n; i += 1) length = length * 256 + (der[at + i] ?? 0);
  return { length, start: at + 1 + n };
}

/**
 * The nonce in the credential certificate's Apple extension: after the OID, an optional critical flag, then
 * an OCTET STRING holding SEQUENCE { [1] { OCTET STRING nonce } }.
 */
function certificateNonce(cert: X509Certificate): Buffer {
  const der = cert.raw;
  const oidAt = der.indexOf(NONCE_OID);
  if (oidAt < 0) throw new AppAttestError('No nonce in the certificate');
  let at = oidAt + NONCE_OID.length;
  if (der[at] === 0x01) at += 3; // BOOLEAN critical
  if (der[at] !== 0x04) throw new AppAttestError('Bad nonce extension');
  const wrapper = derLength(der, at + 1);
  const inner = der.subarray(wrapper.start, wrapper.start + wrapper.length);
  if (inner[0] !== 0x30) throw new AppAttestError('Bad nonce extension');
  const seq = derLength(inner, 1);
  if (inner[seq.start] !== 0xa1) throw new AppAttestError('Bad nonce extension');
  const tagged = derLength(inner, seq.start + 1);
  if (inner[tagged.start] !== 0x04) throw new AppAttestError('Bad nonce extension');
  const octets = derLength(inner, tagged.start + 1);
  return Buffer.from(inner.subarray(octets.start, octets.start + octets.length));
}

/** The key's public point, 0x04 || X || Y, from its certificate. */
function publicPoint(cert: X509Certificate): Buffer {
  const jwk = cert.publicKey.export({ format: 'jwk' });
  if (jwk.crv !== 'P-256' || !jwk.x || !jwk.y) throw new AppAttestError('Not a P-256 key');
  return Buffer.concat([Buffer.from([0x04]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]);
}

/** Which App ID the authenticator data is for: the hash of "TEAMID.bundle.id", one of ours. */
function appIdOf(authData: Buffer, appIds: readonly string[]): string {
  const rpIdHash = authData.subarray(0, 32);
  const appId = appIds.find((id) => sha256(Buffer.from(id)).equals(rpIdHash));
  if (!appId) throw new AppAttestError('For another app');
  return appId;
}

export interface AttestedKey {
  appId: string;
  /** The key, as base64 SPKI, for later assertions. */
  publicKey: string;
  counter: number;
  /** Attested in Apple's development environment (a development build), not production. */
  development: boolean;
}

/**
 * Checks Apple's attestation of a new key, made for `clientDataHash` (the hash of our single-use challenge):
 * its certificate chains to Apple's root, carries the nonce for this challenge, is for the key named
 * `keyId`, for one of our App IDs, and has signed nothing yet.
 */
export function verifyKeyAttestation(input: {
  attestation: Buffer;
  keyId: string;
  clientDataHash: Buffer;
  appIds: readonly string[];
  rootPem?: string;
  now?: Date;
}): AttestedKey {
  let object: Cbor;
  try {
    object = decodeCbor(input.attestation);
  } catch {
    throw new AppAttestError('Not an attestation');
  }
  if (field(object, 'fmt') !== 'apple-appattest') throw new AppAttestError('Not an App Attest attestation');
  const statement = field(object, 'attStmt');
  const x5c = field(statement ?? null, 'x5c');
  if (!Array.isArray(x5c) || x5c.length < 2) throw new AppAttestError('No certificates');
  const authData = bytes(field(object, 'authData'), 'authenticator data');

  let leaf: X509Certificate;
  let intermediate: X509Certificate;
  let root: X509Certificate;
  try {
    leaf = new X509Certificate(bytes(x5c[0], 'certificate'));
    intermediate = new X509Certificate(bytes(x5c[1], 'certificate'));
    root = new X509Certificate(input.rootPem ?? APPLE_APP_ATTEST_ROOT);
  } catch {
    throw new AppAttestError('Unreadable certificates');
  }
  const now = input.now ?? new Date();
  for (const cert of [leaf, intermediate, root]) {
    if (now < new Date(cert.validFrom) || now > new Date(cert.validTo)) throw new AppAttestError('Certificate expired');
  }
  if (
    !leaf.checkIssued(intermediate) ||
    !leaf.verify(intermediate.publicKey) ||
    !intermediate.checkIssued(root) ||
    !intermediate.verify(root.publicKey)
  ) {
    throw new AppAttestError("Not Apple's");
  }

  if (!certificateNonce(leaf).equals(sha256(authData, input.clientDataHash))) {
    throw new AppAttestError('For another challenge');
  }
  const keyId = Buffer.from(input.keyId, 'base64');
  if (!sha256(publicPoint(leaf)).equals(keyId)) throw new AppAttestError('For another key');
  if (authData.length < 55) throw new AppAttestError('Authenticator data too short');
  const appId = appIdOf(authData, input.appIds);
  const counter = authData.readUInt32BE(33);
  if (counter !== 0) throw new AppAttestError('Key already used');
  const aaguid = authData.subarray(37, 53);
  const development = aaguid.equals(AAGUID_DEVELOPMENT);
  if (!development && !aaguid.equals(AAGUID_PRODUCTION)) throw new AppAttestError('Unknown environment');
  const idLength = authData.readUInt16BE(53);
  if (!authData.subarray(55, 55 + idLength).equals(keyId)) throw new AppAttestError('For another key');

  return {
    appId,
    publicKey: leaf.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
    counter,
    development,
  };
}

/**
 * Checks an assertion from an attested key, made for `clientDataHash` (the hash of a request with our
 * single-use challenge): signed by that key, for the same App ID, with a counter past the last one seen, so
 * an assertion can't be used twice. Returns the new counter, to keep.
 */
export function verifyAssertion(input: {
  assertion: Buffer;
  clientDataHash: Buffer;
  publicKey: string;
  counter: number;
  appId: string;
}): number {
  let object: Cbor;
  try {
    object = decodeCbor(input.assertion);
  } catch {
    throw new AppAttestError('Not an assertion');
  }
  const signature = bytes(field(object, 'signature'), 'signature');
  const authData = bytes(field(object, 'authenticatorData'), 'authenticator data');
  if (authData.length < 37) throw new AppAttestError('Authenticator data too short');
  const nonce = sha256(authData, input.clientDataHash);
  const key = createPublicKey({ key: Buffer.from(input.publicKey, 'base64'), format: 'der', type: 'spki' });
  let ok = false;
  try {
    ok = verify('sha256', nonce, { key, dsaEncoding: 'der' }, signature);
  } catch {
    ok = false;
  }
  if (!ok) throw new AppAttestError('Not signed by this key');
  if (appIdOf(authData, [input.appId]) !== input.appId) throw new AppAttestError('For another app');
  const counter = authData.readUInt32BE(33);
  if (counter <= input.counter) throw new AppAttestError('Used before');
  return counter;
}
