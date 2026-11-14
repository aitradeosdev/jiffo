'use client';

import { useActionState, useState } from 'react';
import { SubmitButton } from '@/components/submit-button';
import { inputClass, Notice } from '@/components/ui';
import { decideAccount, type AccountDecisionState } from './actions';

/** Approve or decline one payout account, saying why. The note is kept if the decision is refused. */
export function AccountDecisionForm({ id }: { id: string }) {
  const [state, submit] = useActionState<AccountDecisionState, FormData>(decideAccount, {});
  const [note, setNote] = useState('');
  return (
    <form action={submit} className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-start">
      <input type="hidden" name="id" value={id} />
      <label className="flex-1">
        <span className="sr-only">Why</span>
        <input
          name="note"
          required
          minLength={5}
          maxLength={1000}
          value={note}
          onChange={(e) => setNote(e.currentTarget.value)}
          placeholder="Why, for example: the bank shortens the middle name"
          className={inputClass}
        />
      </label>
      <SubmitButton name="decision" value="approve" pendingLabel="Saving…">
        Approve
      </SubmitButton>
      <SubmitButton name="decision" value="decline" kind="secondary" pendingLabel="Saving…">
        Decline
      </SubmitButton>
      {state.error ? <Notice>{state.error}</Notice> : null}
    </form>
  );
}
