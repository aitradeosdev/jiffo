'use server';

import type { AuthenticationResponseJSON, PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';
import { redirect } from 'next/navigation';
import { api, messageOf } from '@/lib/api';
import { samePath } from '@/lib/same-path';

export interface ConfirmState {
  error?: string;
}

/** A fresh request for the admin's passkey. */
export async function confirmOptions(): Promise<{ options?: PublicKeyCredentialRequestOptionsJSON; error?: string }> {
  try {
    const start = await api<{ method: string; options?: PublicKeyCredentialRequestOptionsJSON }>(
      '/admin/auth/confirm/start',
      { method: 'POST' },
    );
    return start.options ? { options: start.options } : { error: 'Use the code from your authenticator app' };
  } catch (error) {
    return { error: messageOf(error) };
  }
}

export async function confirmWithPasskey(response: AuthenticationResponseJSON, back: string): Promise<ConfirmState> {
  try {
    await api('/admin/auth/confirm', { method: 'POST', body: { response } });
  } catch (error) {
    return { error: messageOf(error) };
  }
  redirect(samePath(back));
}

export async function confirmWithCode(_: ConfirmState, form: FormData): Promise<ConfirmState> {
  try {
    await api('/admin/auth/confirm', {
      method: 'POST',
      body: { code: String(form.get('code') ?? '').replace(/\s/g, '') },
    });
  } catch (error) {
    return { error: messageOf(error) };
  }
  redirect(samePath(String(form.get('back') ?? '/')));
}
