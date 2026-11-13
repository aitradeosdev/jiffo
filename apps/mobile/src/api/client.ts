/**
 * The API client: JSON over fetch, with the access token attached and refreshed when it is about to
 * expire or the server says it has. Concurrent requests share one refresh. Plain TypeScript, so it
 * runs in tests without React Native.
 */

export interface Tokens {
  accessToken: string;
  refreshToken: string;
  /** Epoch milliseconds. */
  accessExpiresAt: number;
}

export interface TokenStore {
  get(): Promise<Tokens | null>;
  set(tokens: Tokens | null): Promise<void>;
}

/** Every API error arrives as { error: { code, message, ...details } }. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiOptions {
  baseUrl: string;
  store: TokenStore;
  fetchImpl?: typeof fetch;
  /** Called once the session can't be refreshed: the app goes back to sign-in. */
  onSignedOut?: () => void;
  now?: () => number;
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
const REFRESH_EARLY_MS = 30_000;

export interface AuthResponse {
  accessToken: string;
  accessTokenExpiresIn: number;
  refreshToken: string;
}

export const toTokens = (r: AuthResponse, now: number): Tokens => ({
  accessToken: r.accessToken,
  refreshToken: r.refreshToken,
  accessExpiresAt: now + r.accessTokenExpiresIn * 1000,
});

export function createApiClient(options: ApiOptions) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  let refreshing: Promise<Tokens | null> | null = null;

  async function send(method: Method, path: string, body: unknown, token: string | null) {
    let res: Response;
    try {
      res = await fetchImpl(`${options.baseUrl}${path}`, {
        method,
        headers: {
          accept: 'application/json',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new ApiError(0, 'network_error', 'Check your connection and try again');
    }
    if (res.status === 204) return { res, json: null };
    const json = await res.json().catch(() => null);
    return { res, json };
  }

  const toError = (status: number, json: unknown) => {
    const err = (json as { error?: { code?: string; message?: string } } | null)?.error;
    const { code, message, ...details } = (err ?? {}) as Record<string, unknown>;
    return new ApiError(status, String(code ?? 'error'), String(message ?? 'Something went wrong'), details);
  };

  /** One refresh at a time; everyone waiting gets the same new tokens (or null when signed out). */
  function refresh(current: Tokens): Promise<Tokens | null> {
    refreshing ??= (async () => {
      try {
        const { res, json } = await send('POST', '/v1/auth/refresh', { refreshToken: current.refreshToken }, null);
        if (res.status === 401) {
          await options.store.set(null);
          options.onSignedOut?.();
          return null;
        }
        if (!res.ok) throw toError(res.status, json);
        const tokens = toTokens(json as AuthResponse, now());
        await options.store.set(tokens);
        return tokens;
      } finally {
        refreshing = null;
      }
    })();
    return refreshing;
  }

  async function validToken(): Promise<Tokens | null> {
    const tokens = await options.store.get();
    if (!tokens) return null;
    return tokens.accessExpiresAt - REFRESH_EARLY_MS > now() ? tokens : refresh(tokens);
  }

  async function request<T>(method: Method, path: string, body?: unknown, auth = true): Promise<T> {
    const tokens = auth ? await validToken() : null;
    if (auth && !tokens) throw new ApiError(401, 'signed_out', 'Sign in to continue');
    let { res, json } = await send(method, path, body, tokens?.accessToken ?? null);
    // The token can still be refused (revoked, clock skew): refresh once and try again.
    if (auth && res.status === 401 && tokens) {
      const fresh = await refresh(tokens);
      if (!fresh) throw new ApiError(401, 'signed_out', 'Sign in to continue');
      ({ res, json } = await send(method, path, body, fresh.accessToken));
    }
    if (!res.ok) throw toError(res.status, json);
    return json as T;
  }

  return {
    get: <T>(path: string) => request<T>('GET', path),
    post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
    put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
    patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
    /** For sign-in and public routes. */
    public: <T>(method: Method, path: string, body?: unknown) => request<T>(method, path, body, false),
    /** The current access token, refreshed if needed. For the realtime socket. */
    accessToken: async () => (await validToken())?.accessToken ?? null,
    store: options.store,
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
