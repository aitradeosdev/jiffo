'use server';

import { redirect } from 'next/navigation';
import type { NoteFormState } from '@/components/note-form';
import { api, messageOf } from '@/lib/api';

const path = (form: FormData, what: string) =>
  `/admin/approvals/${encodeURIComponent(String(form.get('id') ?? ''))}/${what}`;

/** Approves someone else's request: it runs at once, as the person who asked. */
export async function approveRequest(_: NoteFormState, form: FormData): Promise<NoteFormState> {
  try {
    await api(path(form, 'approve'), { method: 'POST', body: {} });
  } catch (error) {
    return { error: messageOf(error) };
  }
  redirect('/approvals?done=approved');
}

export async function rejectRequest(_: NoteFormState, form: FormData): Promise<NoteFormState> {
  try {
    await api(path(form, 'reject'), { method: 'POST', body: { note: String(form.get('note') ?? '') } });
  } catch (error) {
    return { error: messageOf(error) };
  }
  redirect('/approvals?done=rejected');
}

/** Takes back your own request while it waits. */
export async function cancelRequest(_: NoteFormState, form: FormData): Promise<NoteFormState> {
  try {
    await api(path(form, 'cancel'), { method: 'POST' });
  } catch (error) {
    return { error: messageOf(error) };
  }
  redirect('/approvals?done=cancelled');
}
