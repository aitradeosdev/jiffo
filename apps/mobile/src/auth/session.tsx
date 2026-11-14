import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';
import * as Crypto from 'expo-crypto';
import * as Device from 'expo-device';
import { API_URL, VARIANT } from '../config';
import { secureStorage } from '../storage';
import { ApiError, createApiClient, toTokens, type ApiClient, type Tokens } from '../api/client';
import type { CodeSent, SignedIn, User } from '../api/types';

const TOKENS_KEY = `jiffo.${VARIANT}.tokens`;
const DEVICE_KEY = `jiffo.${VARIANT}.device`;

type Status = 'loading' | 'signedOut' | 'signedIn';

interface SessionValue {
  status: Status;
  user: User | null;
  api: ApiClient;
  requestCode(phone: string): Promise<CodeSent>;
  verifyCode(phone: string, code: string): Promise<User>;
  updateProfile(changes: Partial<Pick<User, 'firstName' | 'lastName' | 'email'>>): Promise<User>;
  signOut(): Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

const tokenStore = {
  async get(): Promise<Tokens | null> {
    const raw = await secureStorage.get(TOKENS_KEY);
    try {
      return raw ? (JSON.parse(raw) as Tokens) : null;
    } catch {
      return null;
    }
  },
  set: (tokens: Tokens | null) => secureStorage.set(TOKENS_KEY, tokens ? JSON.stringify(tokens) : null),
};

/** Told when the server ends the session; set by the session provider. */
let onSignedOut: () => void = () => undefined;

/**
 * The one API client in the app. Screens get it through useSession; the agent app's background location
 * task uses it directly. Sharing it means a token refresh is never done twice at once, which the server
 * would take as a stolen refresh token.
 */
export const sharedApi = createApiClient({ baseUrl: API_URL, store: tokenStore, onSignedOut: () => onSignedOut() });

/** A random id for this install, kept across sign-ins, so the server ties sessions and push to this phone. */
async function deviceKey() {
  const existing = await secureStorage.get(DEVICE_KEY);
  if (existing) return existing;
  const key = Crypto.randomUUID();
  await secureStorage.set(DEVICE_KEY, key);
  return key;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [user, setUser] = useState<User | null>(null);
  const signedOut = useRef(() => {
    setUser(null);
    setStatus('signedOut');
  });

  const api = sharedApi;
  useEffect(() => {
    onSignedOut = () => signedOut.current();
    return () => {
      onSignedOut = () => undefined;
    };
  }, []);

  // At launch: a stored session is trusted until the server says otherwise (401). Offline, a server
  // error or a rate limit keeps the person signed in and tries again, so nobody is sent back to SMS
  // sign-in for a problem that isn't theirs.
  const loadUser = useCallback(async () => {
    try {
      setUser(await api.get<User>('/v1/me'));
      setStatus('signedIn');
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        await tokenStore.set(null);
        signedOut.current();
        return true;
      }
      setStatus('signedIn');
      return false;
    }
  }, [api]);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    (async () => {
      if (!(await tokenStore.get())) return signedOut.current();
      for (let attempt = 0; !stopped; attempt += 1) {
        if (await loadUser()) return;
        await new Promise<void>((resolve) => {
          timer = setTimeout(resolve, Math.min(30_000, 2_000 * 2 ** attempt));
        });
      }
    })();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [loadUser]);

  const requestCode = useCallback(
    // The phone's own key goes too, so codes are limited per phone as well as per number.
    async (phone: string) =>
      api.public<CodeSent>('POST', '/v1/auth/otp/request', { phone, deviceKey: await deviceKey() }),
    [api],
  );

  const verifyCode = useCallback(
    async (phone: string, code: string) => {
      const res = await api.public<SignedIn>('POST', '/v1/auth/otp/verify', {
        phone,
        code,
        app: VARIANT,
        device: {
          key: await deviceKey(),
          platform: Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web',
          name: Device.modelName ?? undefined,
        },
      });
      await tokenStore.set(toTokens(res, Date.now()));
      setUser(res.user);
      setStatus('signedIn');
      return res.user;
    },
    [api],
  );

  const updateProfile = useCallback(
    async (changes: Partial<Pick<User, 'firstName' | 'lastName' | 'email'>>) => {
      const next = await api.patch<User>('/v1/me', changes);
      setUser(next);
      return next;
    },
    [api],
  );

  /**
   * Ends the session on the server first, so this phone stops getting pushes. Offline or with the server
   * down, it throws and the person stays signed in; a session the server already ended just clears.
   */
  const signOut = useCallback(async () => {
    try {
      await api.post('/v1/auth/logout');
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 401)) {
        throw new ApiError(0, 'sign_out_failed', "Can't sign out right now. Check your connection and try again.");
      }
    }
    await tokenStore.set(null);
    signedOut.current();
  }, [api]);

  const value = useMemo(
    () => ({ status, user, api, requestCode, verifyCode, updateProfile, signOut }),
    [status, user, api, requestCode, verifyCode, updateProfile, signOut],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside SessionProvider');
  return value;
}
