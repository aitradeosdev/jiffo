'use server';

import { redirect } from 'next/navigation';
import type { NoteFormState } from '@/components/note-form';
import { api, messageOf } from '@/lib/api';

/** An owner closes an alert about a staff member, saying what they found (docs/security-plan.md, D8). */
export async function resolveStaffAlert(_: NoteFormState, form: FormData): Promise<NoteFormState> {
  const id = String(form.get('id') ?? '');
  try {
    await api(`/admin/staff-alerts/${encodeURIComponent(id)}/resolve`, {
      method: 'POST',
      body: { note: String(form.get('note') ?? '') },
    });
  } catch (error) {
    return { error: messageOf(error) };
  }
  redirect('/audit?done=resolved');
}
