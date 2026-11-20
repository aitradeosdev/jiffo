'use client';

import { NoteForm } from '@/components/note-form';
import { handleEmergency } from './actions';

/** Closes an emergency with what the safety team did. */
export function HandleForm({ id }: { id: string }) {
  return (
    <NoteForm
      id={id}
      action={handleEmergency}
      placeholder="What you did, for example: called them back, they were safe"
      buttons={[{ label: 'Mark handled' }]}
    />
  );
}
