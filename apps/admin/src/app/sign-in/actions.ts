'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { api, ApiError, messageOf } from '@/lib/api';
import { CHALLENGE_COOKIE, SESSION_COOKIE, secureCookie } from '@/lib/cookies';

export interface FormState {
  error?: string;
  /** Given back after a refusal, so the form keeps it while the password is typed again. */
  email?: string;
}

/** Step one: email and password. The challenge for step two is kept in an httpOnly cookie for 10 minutes. */
export async function signIn(_: FormState, form: FormData): Promise<FormState> {
  const email = String(form.get('email') ?? '');
  let next: 'code' | 'setup';
  try {
    const res = await api<{ next: 'code' | 'setup'; challenge: string }>('/admin/auth/sign-in', {
      method: 'POST',
      anonymous: true,
      body: { email, password: String(form.get('password') ?? '') },
    });
    (await cookies()).set(CHALLENGE_COOKIE, res.challenge, secureCookie(10 * 60));
    next = res.next;
  } catch (error) {
    return { error: messageOf(error), email };
  }
  redirect(`/sign-in/${next}`);
}

/** Step two: the authenticator code. Success swaps the challenge for a session. */
export async function verifyCode(_: FormState, form: FormData): Promise<FormState> {
  const store = await cookies();
  const challenge = store.get(CHALLENGE_COOKIE)?.value;
  if (!challenge) redirect('/sign-in?ended=challenge');
  try {
    const res = await api<{ token: string; expiresAt: string }>('/admin/auth/code', {
      method: 'POST',
      anonymous: true,
      body: { challenge, code: String(form.get('code') ?? '').replace(/\s/g, '') },
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
