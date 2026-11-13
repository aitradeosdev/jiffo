import { describe, expect, it } from 'vitest';
import { ApiError, createApiClient, type Tokens } from './client';

function memoryStore(initial: Tokens | null) {
  let tokens = initial;
  return { get: async () => tokens, set: async (t: Tokens | null) => void (tokens = t), peek: () => tokens };
}

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;
function fakeFetch(handler: Handler) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    return handler(url, init);
  }) as typeof fetch;
  return { impl, calls };
}
const json = (body: unknown, status = 200) => Response.json(body, { status });
const NOW = 1_000_000;
const fresh: Tokens = { accessToken: 'a1', refreshToken: 'r1', accessExpiresAt: NOW + 600_000 };
const stale: Tokens = { accessToken: 'a0', refreshToken: 'r0', accessExpiresAt: NOW + 10_000 };

describe('api client', () => {
  it('sends the access token and parses JSON', async () => {
    const { impl, calls } = fakeFetch(() => json({ id: 'u1' }));
    const api = createApiClient({
      baseUrl: 'https://api.test',
      store: memoryStore(fresh),
      fetchImpl: impl,
      now: () => NOW,
    });
    expect(await api.get('/v1/me')).toEqual({ id: 'u1' });
    expect(calls[0]!.url).toBe('https://api.test/v1/me');
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer a1');
  });

  it('refreshes a token about to expire, once for many requests at the same time', async () => {
    const store = memoryStore(stale);
    let refreshes = 0;
    const { impl, calls } = fakeFetch(async (url, init) => {
      if (url.endsWith('/v1/auth/refresh')) {
        refreshes += 1;
        expect(JSON.parse(String(init.body))).toEqual({ refreshToken: 'r0' });
        return json({ accessToken: 'a2', accessTokenExpiresIn: 900, refreshToken: 'r2' });
      }
      return json({ ok: (init.headers as Record<string, string>).authorization });
    });
    const api = createApiClient({ baseUrl: '', store, fetchImpl: impl, now: () => NOW });
    const results = await Promise.all([api.get('/a'), api.get('/b'), api.get('/c')]);
    expect(refreshes).toBe(1);
    expect(results).toEqual([{ ok: 'Bearer a2' }, { ok: 'Bearer a2' }, { ok: 'Bearer a2' }]);
    expect(store.peek()).toEqual({ accessToken: 'a2', refreshToken: 'r2', accessExpiresAt: NOW + 900_000 });
    expect(calls.filter((c) => c.url.endsWith('/refresh'))).toHaveLength(1);
  });

  it('retries once after a refused token, then signs out if the refresh is refused too', async () => {
    const store = memoryStore(fresh);
    let signedOut = 0;
    const { impl } = fakeFetch((url) =>
      url.endsWith('/v1/auth/refresh')
        ? json({ error: { code: 'refresh_token_reused', message: 'Sign in again' } }, 401)
        : json({ error: { code: 'session_ended', message: 'Sign in again' } }, 401),
    );
    const api = createApiClient({
      baseUrl: '',
      store,
      fetchImpl: impl,
      now: () => NOW,
      onSignedOut: () => signedOut++,
    });
    await expect(api.get('/v1/me')).rejects.toMatchObject({ status: 401, code: 'signed_out' });
    expect(signedOut).toBe(1);
    expect(store.peek()).toBeNull();
  });

  it('never sends a refresh token that another request already used', async () => {
    const store = memoryStore(fresh);
    const rotated: Tokens = { accessToken: 'a9', refreshToken: 'r9', accessExpiresAt: NOW + 600_000 };
    const { impl, calls } = fakeFetch(async (_url, init) => {
      const auth = (init.headers as Record<string, string>).authorization;
      if (auth === 'Bearer a1') {
        // Meanwhile another request refreshed and stored new tokens; this one gets refused.
        await store.set(rotated);
        return json({ error: { code: 'invalid_token', message: 'Sign in again' } }, 401);
      }
      return json({ ok: auth });
    });
    const api = createApiClient({ baseUrl: '', store, fetchImpl: impl, now: () => NOW });
    expect(await api.get('/v1/me')).toEqual({ ok: 'Bearer a9' });
    expect(calls.some((c) => c.url.endsWith('/v1/auth/refresh'))).toBe(false);
  });

  it('turns error bodies and network failures into ApiError with details', async () => {
    const { impl } = fakeFetch(() =>
      json({ error: { code: 'otp_invalid', message: 'That code is not right', attemptsLeft: 3 } }, 400),
    );
    const api = createApiClient({ baseUrl: '', store: memoryStore(null), fetchImpl: impl });
    const error = await api.public('POST', '/v1/auth/otp/verify', {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 400,
      code: 'otp_invalid',
      message: 'That code is not right',
      details: { attemptsLeft: 3 },
    });

    const offline = createApiClient({
      baseUrl: '',
      store: memoryStore(null),
      fetchImpl: (async () => {
        throw new TypeError('Network request failed');
      }) as typeof fetch,
    });
    await expect(offline.public('GET', '/v1/config/NG')).rejects.toMatchObject({ status: 0, code: 'network_error' });
  });

  it('refuses signed-in calls with no session, without calling the server', async () => {
    const { impl, calls } = fakeFetch(() => json({}));
    const api = createApiClient({ baseUrl: '', store: memoryStore(null), fetchImpl: impl });
    await expect(api.get('/v1/me')).rejects.toMatchObject({ code: 'signed_out' });
    expect(calls).toHaveLength(0);
  });
});
