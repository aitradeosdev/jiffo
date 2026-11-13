'use server';

import { redirect } from 'next/navigation';
import { api, ApiError, messageOf } from '@/lib/api';
import { nairaToKobo } from '@/lib/format';

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

export async function adjustBalance(_: PersonState, form: FormData): Promise<PersonState> {
  const id = String(form.get('id') ?? '');
  const amountKobo = nairaToKobo(String(form.get('amount') ?? ''));
  if (!(amountKobo > 0)) return { error: 'Enter an amount' };
  const errandId = String(form.get('errandId') ?? '');
  try {
    const res = await api<{ posted: boolean }>('/admin/money/adjustments', {
      method: 'POST',
      body: {
        personId: id,
        account: String(form.get('account') ?? ''),
        direction: String(form.get('direction') ?? ''),
        amountKobo,
        note: String(form.get('note') ?? ''),
        requestId: String(form.get('requestId') ?? ''),
        ...(errandId ? { errandId } : {}),
      },
    });
    // The same form was already saved (a retry after a lost answer): say so rather than claim a new change.
    if (!res.posted) return { error: 'This adjustment was already saved. Refresh the page to see it.' };
  } catch (error) {
    return { error: messageOf(error) };
  }
  back(id, 'adjust');
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

const DECISIONS = { approve: 'approved', reject: 'declined', reopen: 'reopened' } as const;

/**
 * Approves or declines an application in review, or reopens a declined one. A decline's reason is what the
 * agent is told.
 */
export async function decideApplication(_: PersonState, form: FormData): Promise<PersonState> {
  const id = String(form.get('id') ?? '');
  const asked = String(form.get('decision') ?? '');
  if (!(asked in DECISIONS)) return { error: 'Choose what to do' };
  const decision = asked as keyof typeof DECISIONS;
  try {
    await api(`/admin/people/${encodeURIComponent(id)}/application`, {
      method: 'POST',
      body: { decision, note: String(form.get('note') ?? '') },
    });
  } catch (error) {
    return { error: messageOf(error) };
  }
  back(id, DECISIONS[decision]);
  return {};
}
