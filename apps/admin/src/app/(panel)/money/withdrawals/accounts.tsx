'use client';

import { NoteForm } from '@/components/note-form';
import { decideAccount } from './actions';

/** Approve or decline one payout account, saying why. */
export function AccountDecisionForm({ id }: { id: string }) {
  return (
    <NoteForm
      id={id}
      action={decideAccount}
      placeholder="Why, for example: the bank shortens the middle name"
      buttons={[
        { label: 'Approve', value: 'approve' },
        { label: 'Decline', value: 'decline', kind: 'secondary' },
      ]}
    />
  );
}
