'use server';

import { revalidatePath } from 'next/cache';
import { api, messageOf } from '@/lib/api';

export interface TeamState {
  error?: string;
  /** What was typed, given back after a refusal so the form keeps it. */
  typed?: { name: string; email: string; role: string };
  /** A fresh invite link, shown once. */
  inviteUrl?: string;
  forEmail?: string;
}

export async function inviteTeammate(_: TeamState, form: FormData): Promise<TeamState> {
  const typed = {
    name: String(form.get('name') ?? ''),
    email: String(form.get('email') ?? '').trim(),
    role: String(form.get('role') ?? ''),
  };
  try {
    const res = await api<{ inviteUrl: string }>('/admin/team', { method: 'POST', body: typed });
    revalidatePath('/team');
    return { inviteUrl: res.inviteUrl, forEmail: typed.email };
  } catch (error) {
    return { error: messageOf(error), typed };
  }
}

export async function updateTeammate(_: TeamState, form: FormData): Promise<TeamState> {
  const role = form.get('role');
  const status = form.get('status');
  try {
    await api(`/admin/team/${encodeURIComponent(String(form.get('id') ?? ''))}`, {
      method: 'PATCH',
      body: { ...(role ? { role: String(role) } : {}), ...(status ? { status: String(status) } : {}) },
    });
    revalidatePath('/team');
    return {};
  } catch (error) {
    return { error: messageOf(error) };
  }
}

export async function resetTeammate(_: TeamState, form: FormData): Promise<TeamState> {
  try {
    const res = await api<{ inviteUrl: string }>(
      `/admin/team/${encodeURIComponent(String(form.get('id') ?? ''))}/reset`,
      {
        method: 'POST',
      },
    );
    revalidatePath('/team');
    return { inviteUrl: res.inviteUrl, forEmail: String(form.get('email') ?? '') };
  } catch (error) {
    return { error: messageOf(error) };
  }
}
