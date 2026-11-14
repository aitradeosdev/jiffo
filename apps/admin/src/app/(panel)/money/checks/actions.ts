'use server';

import { redirect } from 'next/navigation';
import type { NoteFormState as CheckState } from '@/components/note-form';
import { api, messageOf } from '@/lib/api';

/** Finance clears a nightly check that paused instant withdrawals, saying what explained the gap. */
export async function clearCheck(_: CheckState, form: FormData): Promise<CheckState> {
  const id = String(form.get('id') ?? '');
  try {
    await api(`/admin/money/reconciliation/${encodeURIComponent(id)}/clear`, {
      method: 'POST',
      body: { note: String(form.get('note') ?? '') },
    });
  } catch (error) {
    return { error: messageOf(error) };
  }
  redirect('/money/checks?done=cleared');
}

export async function resolveAlert(_: CheckState, form: FormData): Promise<CheckState> {
  const id = String(form.get('id') ?? '');
  try {
    await api(`/admin/alerts/${encodeURIComponent(id)}/resolve`, {
      method: 'POST',
      body: { note: String(form.get('note') ?? '') },
    });
  } catch (error) {
    return { error: messageOf(error) };
  }
  redirect('/money/checks?done=resolved');
}
