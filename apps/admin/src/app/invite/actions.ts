'use server';

import { redirect } from 'next/navigation';
import { api, messageOf } from '@/lib/api';

export interface InviteInfo {
  email: string;
  name: string;
  role: string;
}

export async function readInvite(token: string): Promise<{ invite?: InviteInfo; error?: string }> {
  try {
    return {
      invite: await api<InviteInfo>(`/admin/auth/invite?token=${encodeURIComponent(token)}`, { anonymous: true }),
    };
  } catch (error) {
    return { error: messageOf(error) };
  }
}

export async function acceptInvite(_: { error?: string }, form: FormData): Promise<{ error?: string }> {
  const password = String(form.get('password') ?? '');
  if (password !== String(form.get('confirm') ?? '')) return { error: 'The two passwords are different' };
  try {
    await api('/admin/auth/invite/accept', {
      method: 'POST',
      anonymous: true,
      body: { token: String(form.get('token') ?? ''), password },
    });
  } catch (error) {
    return { error: messageOf(error) };
  }
  redirect('/sign-in?ended=welcome');
}
