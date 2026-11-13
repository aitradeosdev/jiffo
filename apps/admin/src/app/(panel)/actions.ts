'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { api } from '@/lib/api';
import { COUNTRY_COOKIE, SESSION_COOKIE, secureCookie } from '@/lib/cookies';

export async function signOut() {
  await api('/admin/auth/sign-out', { method: 'POST' });
  (await cookies()).delete(SESSION_COOKIE);
  redirect('/sign-in?ended=out');
}

/** Remembers which country the admin is looking at, for a year. */
export async function chooseCountry(form: FormData) {
  const code = String(form.get('country') ?? '').toUpperCase();
  if (/^[A-Z]{2}$/.test(code)) (await cookies()).set(COUNTRY_COOKIE, code, secureCookie(365 * 24 * 3600));
  const back = String(form.get('back') ?? '/');
  redirect(back.startsWith('/') && !back.startsWith('//') ? back : '/');
}
