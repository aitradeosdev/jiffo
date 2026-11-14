import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';

/** CBOR, as much as WebAuthn needs: integers, byte and text strings, and maps. */
function cbor(value: unknown): Buffer {
  const head = (major: number, n: number) => {
    if (n < 24) return Buffer.from([(major << 5) | n]);
    if (n < 256) return Buffer.from([(major << 5) | 24, n]);
    if (n < 65_536) return Buffer.from([(major << 5) | 25, n >> 8, n & 255]);
    const b = Buffer.alloc(5);
    b[0] = (major << 5) | 26;
    b.writeUInt32BE(n, 1);
    return b;
  };
  if (typeof value === 'number') return value >= 0 ? head(0, value) : head(1, -1 - value);
  if (Buffer.isBuffer(value)) return Buffer.concat([head(2, value.length), value]);
  if (typeof value === 'string') {
    const text = Buffer.from(value, 'utf8');
    return Buffer.concat([head(3, text.length), text]);
  }
  if (value instanceof Map) {
    return Buffer.concat([head(5, value.size), ...[...value].flatMap(([k, v]) => [cbor(k), cbor(v)])]);
  }
  throw new Error(`cbor: can't encode ${typeof value}`);
}

const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest();
const b64 = (data: Buffer | string) => Buffer.from(data).toString('base64url');
const u32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
};

/**
 * A passkey in software, answering as a phone or laptop would (a P-256 key, user present and verified), so
 * the tests can add passkeys and sign in with them. The answers can be bent to show what the API refuses.
 */
export class SoftPasskey {
  readonly rawId = randomBytes(16);
  private readonly keys = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  private count = 0;

  constructor(
    private readonly origin = 'http://localhost:3001',
    private readonly rpId = 'localhost',
  ) {}

  get id() {
    return b64(this.rawId);
  }

  /** The answer to registration options: a new credential, with "none" attestation. */
  register(options: { challenge: string }, bend: { origin?: string } = {}) {
    const clientData = JSON.stringify({
      type: 'webauthn.create',
      challenge: options.challenge,
      origin: bend.origin ?? this.origin,
      crossOrigin: false,
    });
    const jwk = this.keys.publicKey.export({ format: 'jwk' });
    const cose = cbor(
      new Map<number, unknown>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, Buffer.from(jwk.x!, 'base64url')],
        [-3, Buffer.from(jwk.y!, 'base64url')],
      ]),
    );
    const idLength = Buffer.from([this.rawId.length >> 8, this.rawId.length & 255]);
    // Flags: user present, user verified, attested credential data included.
    const authData = Buffer.concat([
      sha256(this.rpId),
      Buffer.from([0x45]),
      u32(0),
      Buffer.alloc(16),
      idLength,
      this.rawId,
      cose,
    ]);
    const attestationObject = cbor(
      new Map<string, unknown>([
        ['fmt', 'none'],
        ['attStmt', new Map()],
        ['authData', authData],
      ]),
    );
    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key' as const,
      response: {
        clientDataJSON: b64(clientData),
        attestationObject: b64(attestationObject),
        transports: ['internal'],
      },
      clientExtensionResults: {},
    };
  }

  /** The answer to authentication options: a signature over the request, as a passkey makes it. */
  sign(options: { challenge: string }, bend: { origin?: string; verified?: boolean; count?: number } = {}) {
    this.count = bend.count ?? this.count + 1;
    const clientData = JSON.stringify({
      type: 'webauthn.get',
      challenge: options.challenge,
      origin: bend.origin ?? this.origin,
      crossOrigin: false,
    });
    const flags = bend.verified === false ? 0x01 : 0x05;
    const authData = Buffer.concat([sha256(this.rpId), Buffer.from([flags]), u32(this.count)]);
    const signature = sign('sha256', Buffer.concat([authData, sha256(clientData)]), this.keys.privateKey);
    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key' as const,
      response: { clientDataJSON: b64(clientData), authenticatorData: b64(authData), signature: b64(signature) },
      clientExtensionResults: {},
    };
  }
}
