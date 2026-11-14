'use server';

import { redirect } from 'next/navigation';
import { api, messageOf } from '@/lib/api';

export interface AccountDecisionState {
  error?: string;
}

/** Finance approves or declines a payout account whose bank name only nearly matched the legal name. */
export async function decideAccount(_: AccountDecisionState, form: FormData): Promise<AccountDecisionState> {
  const id = String(form.get('id') ?? '');
  const decision = form.get('decision') === 'approve' ? 'approve' : 'decline';
  try {
    await api(`/admin/money/payout-accounts/${encodeURIComponent(id)}/decision`, {
      method: 'POST',
      body: { decision, note: String(form.get('note') ?? '') },
    });
  } catch (error) {
    return { error: messageOf(error) };
  }
  redirect(`/money/withdrawals?done=${decision}`);
}
