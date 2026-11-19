'use server';

import { redirect } from 'next/navigation';
import type { NoteFormState } from '@/components/note-form';
import { api, messageOf } from '@/lib/api';

const DECISIONS = ['clear', 'confirm', 'reopen'] as const;

/** Clears, confirms or reopens a fraud flag, saying why. */
export async function decideFlag(_: NoteFormState, form: FormData): Promise<NoteFormState> {
  const id = String(form.get('id') ?? '');
  const decision = DECISIONS.find((d) => d === form.get('decision')) ?? 'clear';
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
