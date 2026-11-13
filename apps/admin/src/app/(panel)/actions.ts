'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { api } from '@/lib/api';
import { COUNTRY_COOKIE, SESSION_COOKIE, secureCookie } from '@/lib/cookies';
import { samePath } from '@/lib/same-path';

/** The cookie goes first, so signing out works even if the session already ended or the API is down. */
export async function signOut() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  store.delete(SESSION_COOKIE);
  if (token) {
    try {
      await api('/admin/auth/sign-out', { method: 'POST', token });
    } catch {
      // Already ended, or the API is unreachable: either way this browser is signed out.
    }
  }
  redirect('/sign-in?ended=out');
}

/** Remembers which country the admin is looking at, for a year. */
export async function chooseCountry(form: FormData) {
  const code = String(form.get('country') ?? '').toUpperCase();
  if (/^[A-Z]{2}$/.test(code)) (await cookies()).set(COUNTRY_COOKIE, code, secureCookie(365 * 24 * 3600));
  redirect(samePath(String(form.get('back') ?? '/')));
}
