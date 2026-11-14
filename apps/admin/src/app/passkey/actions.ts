'use server';

import type { PublicKeyCredentialCreationOptionsJSON, RegistrationResponseJSON } from '@simplewebauthn/browser';
import { redirect } from 'next/navigation';
import { api, messageOf } from '@/lib/api';

/** What the browser needs to make a passkey for the signed-in admin. */
export async function registrationOptions(): Promise<{
  options?: PublicKeyCredentialCreationOptionsJSON;
  error?: string;
}> {
  try {
    return { options: await api('/admin/auth/passkeys/options', { method: 'POST' }) };
  } catch (error) {
    return { error: messageOf(error) };
  }
}

/** Keeps the passkey the browser made. */
export async function addPasskey(response: RegistrationResponseJSON, name: string): Promise<{ error?: string }> {
  try {
    await api('/admin/auth/passkeys', { method: 'POST', body: { response, name } });
  } catch (error) {
    return { error: messageOf(error) };
  }
  redirect('/?done=passkey');
}
