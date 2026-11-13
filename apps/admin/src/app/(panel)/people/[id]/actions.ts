'use server';

import { redirect } from 'next/navigation';
import { api, ApiError, messageOf } from '@/lib/api';

export interface PersonState {
  error?: string;
  /** Errands in progress that stop a suspension, so the form can link them. */
  errandIds?: string[];
}

const back = (id: string, done: string) => redirect(`/people/${encodeURIComponent(id)}?done=${done}`);

export async function setTier(_: PersonState, form: FormData): Promise<PersonState> {
  const id = String(form.get('id') ?? '');
  try {
    await api(`/admin/people/${encodeURIComponent(id)}/tier`, {
      method: 'POST',
      body: { tier: String(form.get('tier') ?? ''), note: String(form.get('note') ?? '') },
    });
  } catch (error) {
    return { error: messageOf(error) };
  }
  back(id, 'tier');
  return {};
}

export async function changeAccess(_: PersonState, form: FormData): Promise<PersonState> {
  const id = String(form.get('id') ?? '');
  const what = form.get('what') === 'reactivate' ? 'reactivate' : 'suspend';
  try {
    await api(`/admin/people/${encodeURIComponent(id)}/${what}`, {
      method: 'POST',
      body: { note: String(form.get('note') ?? '') },
    });
  } catch (error) {
    if (error instanceof ApiError && error.code === 'has_live_errands') {
      return { error: error.message, errandIds: (error.details.errandIds as string[] | undefined) ?? [] };
    }
    return { error: messageOf(error) };
  }
  back(id, what);
  return {};
}
