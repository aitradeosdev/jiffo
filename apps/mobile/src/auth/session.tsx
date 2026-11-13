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

  const api = useMemo(
    () => createApiClient({ baseUrl: API_URL, store: tokenStore, onSignedOut: () => signedOut.current() }),
    [],
  );

  useEffect(() => {
    (async () => {
      if (!(await tokenStore.get())) return signedOut.current();
      try {
        setUser(await api.get<User>('/v1/me'));
        setStatus('signedIn');
      } catch (error) {
        // Offline at launch: keep the session and let screens retry, rather than signing the person out.
        if (error instanceof ApiError && error.status === 0) setStatus('signedIn');
        else signedOut.current();
      }
    })();
  }, [api]);

  const requestCode = useCallback(
    (phone: string) => api.public<CodeSent>('POST', '/v1/auth/otp/request', { phone }),
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

  const signOut = useCallback(async () => {
    await api.post('/v1/auth/logout').catch(() => undefined);
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
