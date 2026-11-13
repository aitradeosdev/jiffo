import 'server-only';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { clientIp } from './client-ip';
import { COUNTRY_COOKIE, SESSION_COOKIE } from './cookies';
import { env } from './env';

/** An error answer from the API, with its code and message as the API wrote them. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

/** The headers that tell the API who is really asking: the admin's IP and browser, vouched for by the secret. */
async function clientHeaders(): Promise<Record<string, string>> {
  const h = await headers();
  const { panelSecret, trustProxyHops } = env();
  if (!panelSecret) return {};
  const ip = clientIp(h.get('x-forwarded-for'), trustProxyHops);
  return {
    'x-jiffo-panel': panelSecret,
    ...(ip ? { 'x-jiffo-client-ip': ip } : {}),
    'x-jiffo-client-ua': (h.get('user-agent') ?? '').slice(0, 300),
  };
}

interface CallOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  /** Sign-in calls are made before there is a session. */
  anonymous?: boolean;
}

/**
 * Calls the API from the panel's server. A missing or ended session sends the admin to sign in, so pages
 * never render half-signed-in.
 */
export async function api<T>(path: string, options: CallOptions = {}): Promise<T> {
  const token = options.anonymous ? null : (await cookies()).get(SESSION_COOKIE)?.value;
  if (!options.anonymous && !token) redirect('/sign-in');
  const res = await fetch(`${env().apiUrl}/v1${path}`, {
    method: options.method ?? 'GET',
    headers: {
      ...(await clientHeaders()),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    cache: 'no-store',
  });
  if (res.status === 204) return undefined as T;
  const json = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
  if (!res.ok) {
    const { code = 'error', message = 'Something went wrong. Try again.', ...details } = json.error ?? {};
    if (res.status === 401 && !options.anonymous) redirect(`/sign-in?ended=${code === 'session_idle' ? 'idle' : '1'}`);
    throw new ApiError(res.status, code, message, details);
  }
  return json as T;
}

export interface Country {
  code: string;
  name: string;
  currency: string;
  timezone: string;
}

export type Permission = 'read' | 'operate' | 'money' | 'settings' | 'team';

export interface Me {
  id: string;
  email: string;
  name: string;
  role: 'owner' | 'operations' | 'finance' | 'support';
  permissions: Permission[];
  countries: Country[];
}

/** The signed-in admin, fetched once per request however many components ask. */
export const getMe = cache(() => api<Me>('/admin/me'));

/** The country the admin is looking at: their last choice, or the first one. */
export const getCountry = cache(async (): Promise<Country> => {
  const me = await getMe();
  const chosen = (await cookies()).get(COUNTRY_COOKIE)?.value;
  const country = me.countries.find((c) => c.code === chosen) ?? me.countries[0];
  if (!country) throw new Error('No country is switched on');
  return country;
});

/** For actions: the API's message for an expected refusal, or a general one for anything else. */
export function messageOf(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  throw error;
}
