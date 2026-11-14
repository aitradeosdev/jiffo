'use client';

import { NoteForm } from '@/components/note-form';
import { clearCheck, resolveAlert } from './actions';

export function ClearCheckForm({ id }: { id: string }) {
  return (
    <NoteForm
      id={id}
      action={clearCheck}
      placeholder="What explained the gap, and what was done"
      buttons={[{ label: 'Clear and restart instant withdrawals' }]}
    />
  );
}

export function ResolveAlertForm({ id }: { id: string }) {
  return (
    <NoteForm id={id} action={resolveAlert} placeholder="What was found or done" buttons={[{ label: 'Resolve' }]} />
  );
}
