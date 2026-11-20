'use client';

import { NoteForm } from '@/components/note-form';
import { resolveStaffAlert } from './actions';

export function ResolveStaffAlertForm({ id }: { id: string }) {
  return (
    <NoteForm
      id={id}
      action={resolveStaffAlert}
      placeholder="What you found when you asked about it"
      buttons={[{ label: 'Close' }]}
    />
  );
}
