import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { PlayIntegrityUnavailable, PlayIntegrityVerifier } from '../src/attestation/play-integrity';

const account = JSON.stringify({
  project_id: 'jiffo-test',
  client_email: 'integrity@jiffo-test.iam.gserviceaccount.com',
  private_key: generateKeyPairSync('rsa', { modulusLength: 2048 })
    .privateKey.export({ type: 'pkcs8', format: 'pem' })
    .toString(),
});
const PACKAGES = { customer: 'com.jiffoapp.customer', agent: 'com.jiffoapp.agent' };
const DIGEST = 'ab'.repeat(32);
const HASH = 'c0ffee'.repeat(10) + 'beef';
const NOW = Date.parse('2026-11-19T12:00:00Z');

/** Google's answer for a token: the decoded verdict, or a status. */
function google(payload: object | null, status = 200) {
  const calls: string[] = [];
  const impl = (async (url: string | URL) => {
    calls.push(String(url));
    if (String(url).endsWith('/token')) return new Response(JSON.stringify({ access_token: 'g', expires_in: 3600 }));
    return new Response(JSON.stringify(payload ? { tokenPayloadExternal: payload } : {}), { status });
  }) as typeof fetch;
  return { verifier: new PlayIntegrityVerifier(account, PACKAGES, [DIGEST], impl), calls };
}
const genuine = (overrides: Record<string, unknown> = {}) => ({
  requestDetails: { requestPackageName: 'com.jiffoapp.agent', requestHash: HASH, timestampMillis: String(NOW - 5_000) },
  appIntegrity: {
    appRecognitionVerdict: 'PLAY_RECOGNIZED',
    packageName: 'com.jiffoapp.agent',
    certificateSha256Digest: [Buffer.from(DIGEST, 'hex').toString('base64url')],
  },
  deviceIntegrity: { deviceRecognitionVerdict: ['MEETS_DEVICE_INTEGRITY'] },
  accountDetails: { appLicensingVerdict: 'LICENSED' },
  ...overrides,
});

describe('Google Play Integrity (MB3)', () => {
  it('trusts our app as Play installed it, on a genuine phone, for this request', async () => {
    const { verifier, calls } = google(genuine());
    expect(await verifier.verify('token', HASH, 'agent', NOW)).toEqual({ verdict: 'trusted', reasons: [] });
    // Decoded under the app it came from.
    expect(calls[1]).toBe('https://playintegrity.googleapis.com/v1/com.jiffoapp.agent:decodeIntegrityToken');
  });

  it('fails another app, another request, an old token, a changed app or another signing key', async () => {
    const failed = async (payload: object, app: 'agent' | 'customer' = 'agent') =>
      (await google(payload).verifier.verify('token', HASH, app, NOW)).verdict;
    expect(await failed(genuine(), 'customer')).toBe('failed');
    expect(await failed(genuine({ requestDetails: { ...genuine().requestDetails, requestHash: 'other' } }))).toBe(
      'failed',
    );
    expect(
      await failed(
        genuine({ requestDetails: { ...genuine().requestDetails, timestampMillis: String(NOW - 3_600_000) } }),
      ),
    ).toBe('failed');
    expect(
      await failed(
        genuine({ appIntegrity: { ...genuine().appIntegrity, appRecognitionVerdict: 'UNRECOGNIZED_VERSION' } }),
      ),
    ).toBe('failed');
    expect(
      await failed(genuine({ appIntegrity: { ...genuine().appIntegrity, certificateSha256Digest: ['someone-else'] } })),
    ).toBe('failed');
    // A token Google can't read.
    expect((await google(null, 400).verifier.verify('junk', HASH, 'agent', NOW)).verdict).toBe('failed');
  });

  it('doubts a rooted phone, an emulator, an app Play could not check, or one not from Play', async () => {
    const check = async (payload: object) => google(payload).verifier.verify('token', HASH, 'agent', NOW);
    expect(await check(genuine({ deviceIntegrity: { deviceRecognitionVerdict: ['MEETS_BASIC_INTEGRITY'] } }))).toEqual({
      verdict: 'doubtful',
      reasons: ['A rooted or changed phone'],
    });
    expect(
      (await check(genuine({ deviceIntegrity: { deviceRecognitionVerdict: ['MEETS_VIRTUAL_INTEGRITY'] } }))).reasons,
    ).toEqual(['An emulator']);
    expect(
      (await check(genuine({ appIntegrity: { ...genuine().appIntegrity, appRecognitionVerdict: 'UNEVALUATED' } })))
        .verdict,
    ).toBe('doubtful');
    expect((await check(genuine({ accountDetails: { appLicensingVerdict: 'UNLICENSED' } }))).reasons).toEqual([
      'Not installed from Play',
    ]);
  });

  it("says when Google can't be asked, so it isn't counted against the person", async () => {
    await expect(google(null, 503).verifier.verify('token', HASH, 'agent', NOW)).rejects.toBeInstanceOf(
      PlayIntegrityUnavailable,
    );
  });
});
