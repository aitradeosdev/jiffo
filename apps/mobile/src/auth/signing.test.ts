import { createHash, generateKeyPairSync, sign, verify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SIGNED_HEADERS, signedRequest } from './signing';

/** The API's own check, written out here from its format, so a drift between the two fails this test. */
const serverAccepts = (
  publicKey: ReturnType<typeof generateKeyPairSync>['publicKey'],
  nonce: string,
  method: string,
  path: string,
  body: string,
  signature: string,
) =>
  verify(
    'sha256',
    Buffer.from([nonce, method, path, createHash('sha256').update(body).digest('hex')].join('\n')),
    { key: publicKey, dsaEncoding: 'der' },
    Buffer.from(signature, 'base64'),
  );

describe('signed money requests', () => {
  it('signs over the code, method, path and body as the API checks them, and sends the PIN', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const sent: Array<{ method: string; path: string; body: unknown; headers: Record<string, string> }> = [];
    const api = {
      post: async <T>(path: string) => {
        expect(path).toBe('/v1/devices/current/challenge');
        return { nonce: 'code-123' } as T;
      },
      withHeaders: async <T>(method: string, path: string, body: unknown, headers: Record<string, string>) => {
        sent.push({ method, path, body, headers });
        return { id: 'payout-1' } as T;
      },
    };
    const body = { amountKobo: 100_000, speed: 'scheduled', requestId: 'r-1' };
    const result = await signedRequest<{ id: string }>(
      {
        api: api as never,
        sign: async (text) =>
          sign('sha256', Buffer.from(text), { key: privateKey, dsaEncoding: 'der' }).toString('base64'),
        sha256Hex: async (text) => createHash('sha256').update(text).digest('hex'),
      },
      'POST',
      '/v1/wallet/withdrawals',
      body,
      '2580',
    );
    expect(result).toEqual({ id: 'payout-1' });
    const [request] = sent;
    expect(request!.headers[SIGNED_HEADERS.nonce]).toBe('code-123');
    expect(request!.headers[SIGNED_HEADERS.pin]).toBe('2580');
    // The body the client sends is JSON.stringify(body), the same string that was signed.
    expect(
      serverAccepts(
        publicKey,
        'code-123',
        'POST',
        '/v1/wallet/withdrawals',
        JSON.stringify(request!.body),
        request!.headers[SIGNED_HEADERS.signature]!,
      ),
    ).toBe(true);
    // A changed amount would not pass.
    expect(
      serverAccepts(
        publicKey,
        'code-123',
        'POST',
        '/v1/wallet/withdrawals',
        JSON.stringify({ ...body, amountKobo: 900_000 }),
        request!.headers[SIGNED_HEADERS.signature]!,
      ),
    ).toBe(false);
  });

  it("makes the app check before taking the phone's short-lived code, and sends both", async () => {
    const order: string[] = [];
    const api = {
      post: async <T>() => {
        order.push('challenge');
        return { nonce: 'code-9' } as T;
      },
      withHeaders: async <T>(_m: string, _p: string, _b: unknown, headers: Record<string, string>) => {
        order.push('send');
        return headers as T;
      },
    };
    const headers = await signedRequest<Record<string, string>>(
      {
        api: api as never,
        sign: async () => 'sig',
        sha256Hex: async (text) => createHash('sha256').update(text).digest('hex'),
        attest: async () => {
          order.push('attest');
          return { 'x-jiffo-attest': 'token' };
        },
      },
      'POST',
      '/v1/wallet/withdrawals',
      {},
      '2580',
    );
    expect(order).toEqual(['attest', 'challenge', 'send']);
    expect(headers).toMatchObject({ 'x-jiffo-attest': 'token', [SIGNED_HEADERS.nonce]: 'code-9' });
  });
});
