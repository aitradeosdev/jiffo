'use server';

import { redirect } from 'next/navigation';
import type { NoteFormState } from '@/components/note-form';
import { api, messageOf } from '@/lib/api';
import { flagDecisionOf } from '@/lib/flags';

/** Clears, confirms or reopens a fraud flag, saying why. Only a button pressed decides: never a default. */
export async function decideFlag(_: NoteFormState, form: FormData): Promise<NoteFormState> {
  const id = String(form.get('id') ?? '');
  const decision = flagDecisionOf(form.get('decision'));
  if (!decision) return { error: 'Choose what to do with the flag.' };
  let queue: string;
  try {
    ({ queue } = await api<{ queue: string }>(`/admin/flags/${encodeURIComponent(id)}/decision`, {
      method: 'POST',
      body: { decision, note: String(form.get('note') ?? '') },
    }));
  } catch (error) {
    return { error: messageOf(error) };
  }
  redirect(`/flags?queue=${queue === 'verification' ? 'verification' : 'risk'}&done=${decision}`);
}
