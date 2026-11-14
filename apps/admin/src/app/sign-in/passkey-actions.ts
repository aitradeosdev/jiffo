'use server';

import type { AuthenticationResponseJSON, PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { api, ApiError, messageOf } from '@/lib/api';
import { CHALLENGE_COOKIE, SESSION_COOKIE, secureCookie } from '@/lib/cookies';

/** What the browser needs to ask for the admin's passkey, for the sign-in in progress. */
export async function signInOptions(): Promise<{ options?: PublicKeyCredentialRequestOptionsJSON; error?: string }> {
  const challenge = (await cookies()).get(CHALLENGE_COOKIE)?.value;
  if (!challenge) redirect('/sign-in?ended=challenge');
  try {
    return {
      options: await api('/admin/auth/passkey/options', { method: 'POST', anonymous: true, body: { challenge } }),
    };
  } catch (error) {
    if (error instanceof ApiError && error.code === 'challenge_expired') redirect('/sign-in?ended=challenge');
    return { error: messageOf(error) };
  }
}

/** The passkey's answer. Success swaps the challenge for a session. */
export async function finishSignIn(response: AuthenticationResponseJSON): Promise<{ error?: string }> {
  const store = await cookies();
  const challenge = store.get(CHALLENGE_COOKIE)?.value;
  if (!challenge) redirect('/sign-in?ended=challenge');
  try {
    const res = await api<{ token: string; expiresAt: string }>('/admin/auth/passkey', {
      method: 'POST',
      anonymous: true,
      body: { challenge, response },
    });
    const seconds = Math.max(60, Math.floor((Date.parse(res.expiresAt) - Date.now()) / 1000));
    store.set(SESSION_COOKIE, res.token, secureCookie(seconds));
    store.delete(CHALLENGE_COOKIE);
  } catch (error) {
    if (error instanceof ApiError && error.code === 'challenge_expired') redirect('/sign-in?ended=challenge');
    return { error: messageOf(error) };
  }
  redirect('/');
}
