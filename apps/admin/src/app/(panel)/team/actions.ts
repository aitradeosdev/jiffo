'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { api, ASKED, isPending, messageOf } from '@/lib/api';

export interface TeamState {
  error?: string;
  /** What was typed, given back after a refusal so the form keeps it. */
  typed?: { name: string; email: string; role: string };
  /** Where the link went, only ever the teammate's own email, and for how long it works. */
  emailed?: { to: string; hours: number };
}

export async function inviteTeammate(_: TeamState, form: FormData): Promise<TeamState> {
  const typed = {
    name: String(form.get('name') ?? ''),
    email: String(form.get('email') ?? '').trim(),
    role: String(form.get('role') ?? ''),
  };
  let res: { emailedTo: string; expiresInHours: number };
  try {
    res = await api<{ emailedTo: string; expiresInHours: number }>('/admin/team', { method: 'POST', body: typed });
  } catch (error) {
    return { error: messageOf(error), typed };
  }
  // A new teammate waits for a second owner (docs/security-plan.md, D4).
  if (isPending(res)) redirect(ASKED);
  revalidatePath('/team');
  return { emailed: { to: res.emailedTo, hours: res.expiresInHours } };
}

export async function updateTeammate(_: TeamState, form: FormData): Promise<TeamState> {
  const role = form.get('role');
  const status = form.get('status');
  let pending = false;
  try {
    pending = isPending(
      await api(`/admin/team/${encodeURIComponent(String(form.get('id') ?? ''))}`, {
        method: 'PATCH',
        body: { ...(role ? { role: String(role) } : {}), ...(status ? { status: String(status) } : {}) },
      }),
    );
  } catch (error) {
    return { error: messageOf(error) };
  }
  // A role change, or giving access back, waits for a second owner.
  if (pending) redirect(ASKED);
  revalidatePath('/team');
  return {};
}

export async function resetTeammate(_: TeamState, form: FormData): Promise<TeamState> {
  try {
    const res = await api<{ emailedTo: string; expiresInHours: number }>(
      `/admin/team/${encodeURIComponent(String(form.get('id') ?? ''))}/reset`,
      { method: 'POST' },
    );
    revalidatePath('/team');
    return { emailed: { to: res.emailedTo, hours: res.expiresInHours } };
  } catch (error) {
    return { error: messageOf(error) };
  }
}
