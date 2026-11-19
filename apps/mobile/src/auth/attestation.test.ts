import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { ATTEST_HEADERS, attestationHeaders, type AttestDeps, type AttestNative } from './attestation';

const sha256Hex = async (text: string) => createHash('sha256').update(text).digest('hex');
/** The API's own hash of a checked request (apps/api/src/attestation/attestation.types.ts), written out. */
const serverHash = (nonce: string, method: string, path: string, body: string) =>
  createHash('sha256')
    .update([nonce, method, path, createHash('sha256').update(body).digest('hex')].join('\n'))
    .digest('hex');

function deps(platform: 'ios' | 'android', native: Partial<AttestNative> = {}) {
  let n = 0;
  const calls: Array<{ path: string; body: unknown }> = [];
  const api = {
    public: vi.fn(async (_m: string, path: string, body?: unknown) => {
      calls.push({ path, body });
      return path.endsWith('/challenge') ? { nonce: `nonce-${(n += 1)}` } : undefined;
    }),
  } as unknown as AttestDeps['api'];
  let kept: string | null = null;
  const fake: AttestNative = {
    integrityToken: vi.fn(async (hash: string) => `play:${hash}`),
    newAppleKey: vi.fn(async () => 'key-1'),
    attestAppleKey: vi.fn(async (keyId: string, hash: string) => `attestation:${keyId}:${hash}`),
    appleAssertion: vi.fn(async (keyId: string, hash: string) => `assertion:${keyId}:${hash}`),
    ...native,
  };
  const d: AttestDeps = {
    api,
    native: fake,
    platform,
    app: 'agent',
    deviceKey: async () => 'install-1',
    sha256Hex,
    appleKey: { get: async () => kept, set: async (k) => void (kept = k) },
  };
  return { d, calls, fake };
}

const BODY = { amountKobo: 100_000, speed: 'scheduled', requestId: 'r-1' };

describe('app checks from the phone (MB3)', () => {
  it("covers the request on Android, as the server hashes it, with this install's code", async () => {
    const { d, calls } = deps('android');
    const headers = await attestationHeaders(d, 'POST', '/v1/wallet/withdrawals', BODY);
    const hash = serverHash('nonce-1', 'POST', '/v1/wallet/withdrawals', JSON.stringify(BODY));
    expect(headers).toEqual({ [ATTEST_HEADERS.nonce]: 'nonce-1', [ATTEST_HEADERS.token]: `play:${hash}` });
    expect(calls).toEqual([{ path: '/v1/attestation/challenge', body: { deviceKey: 'install-1' } }]);
  });

  it('registers the iPhone key once, attested over its own code, then signs each request with it', async () => {
    const { d, calls, fake } = deps('ios');
    const first = await attestationHeaders(d, 'PUT', '/v1/payout-account', BODY);
    expect(calls.map((c) => c.path)).toEqual([
      '/v1/attestation/challenge',
      '/v1/attestation/apple-key',
      '/v1/attestation/challenge',
    ]);
    expect(calls[1]!.body).toEqual({
      deviceKey: 'install-1',
      app: 'agent',
      keyId: 'key-1',
      attestation: `attestation:key-1:${await sha256Hex('nonce-1')}`,
      nonce: 'nonce-1',
    });
    const hash = serverHash('nonce-2', 'PUT', '/v1/payout-account', JSON.stringify(BODY));
    expect(first).toEqual({
      [ATTEST_HEADERS.nonce]: 'nonce-2',
      [ATTEST_HEADERS.token]: `assertion:key-1:${hash}`,
      [ATTEST_HEADERS.keyId]: 'key-1',
    });
    await attestationHeaders(d, 'PUT', '/v1/payout-account', BODY);
    expect(fake.newAppleKey).toHaveBeenCalledTimes(1);
    expect(fake.attestAppleKey).toHaveBeenCalledTimes(1);
  });

  it("sends nothing when the phone can't check, and keeps no key the server didn't take", async () => {
    const { d } = deps('android', { integrityToken: async () => Promise.reject(new Error('no Play')) });
    expect(await attestationHeaders(d, 'POST', '/v1/wallet/withdrawals', BODY)).toEqual({});
    expect(await attestationHeaders({ ...d, native: null }, 'POST', '/v1/wallet/withdrawals', BODY)).toEqual({});

    const ios = deps('ios');
    (ios.d.api.public as ReturnType<typeof vi.fn>).mockImplementation(async (_m: string, path: string) => {
      if (path.endsWith('/apple-key')) throw new Error('not set up');
      return { nonce: 'n' };
    });
    expect(await attestationHeaders(ios.d, 'POST', '/v1/wallet/withdrawals', BODY)).toEqual({});
    expect(await ios.d.appleKey.get()).toBeNull();
  });
});
