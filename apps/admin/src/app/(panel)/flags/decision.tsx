'use client';

import { NoteForm } from '@/components/note-form';
import { decideFlag } from './actions';

/** Clear or confirm an open flag, or reopen a decided one, saying why. */
export function FlagDecisionForm({ id, open }: { id: string; open: boolean }) {
  return (
    <NoteForm
      id={id}
      action={decideFlag}
      noEnter
      placeholder={open ? 'What you found, for example: siblings, checked by call' : 'Why it needs another look'}
      buttons={
        open
          ? [
              { label: 'Clear', value: 'clear', kind: 'secondary' },
              { label: 'Confirm fraud', value: 'confirm', kind: 'danger' },
            ]
          : [{ label: 'Reopen', value: 'reopen', kind: 'secondary' }]
      }
    />
  );
}
