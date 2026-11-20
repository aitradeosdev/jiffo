'use client';

import { NoteForm } from '@/components/note-form';
import { takeEvidence } from './actions';

/** Takes another evidence pack of what the errand holds now, saying why. */
export function EvidenceForm({ id }: { id: string }) {
  return (
    <NoteForm
      id={id}
      action={takeEvidence}
      placeholder="Why, for example: more was said in the chat"
      buttons={[{ label: 'Take another pack', kind: 'secondary' }]}
    />
  );
}
