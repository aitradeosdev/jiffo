'use server';

import { redirect } from 'next/navigation';
import type { NoteFormState } from '@/components/note-form';
import { api, messageOf } from '@/lib/api';

/** The safety team followed an emergency up: what they did. */
export async function handleEmergency(_: NoteFormState, form: FormData): Promise<NoteFormState> {
  const id = String(form.get('id') ?? '');
  try {
    await api(`/admin/safety/${encodeURIComponent(id)}/handle`, {
      method: 'POST',
      body: { note: String(form.get('note') ?? '') },
    });
  } catch (error) {
    return { error: messageOf(error) };
  }
  redirect('/safety?done=1');
}
