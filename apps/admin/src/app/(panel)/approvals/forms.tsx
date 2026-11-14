'use client';

import { useActionState } from 'react';
import { NoteForm, type NoteFormState } from '@/components/note-form';
import { SubmitButton } from '@/components/submit-button';
import { Notice } from '@/components/ui';
import { approveRequest, cancelRequest, rejectRequest } from './actions';

/** One button, for an action that needs no note. */
function OneClick({
  id,
  action,
  label,
  kind,
}: {
  id: string;
  action: (state: NoteFormState, form: FormData) => Promise<NoteFormState>;
  label: string;
  kind?: 'primary' | 'secondary';
}) {
  const [state, submit] = useActionState<NoteFormState, FormData>(action, {});
  return (
    <form action={submit} className="flex flex-col gap-2">
      <input type="hidden" name="id" value={id} />
      <SubmitButton kind={kind} pendingLabel="Saving…">
        {label}
      </SubmitButton>
      {state.error ? <Notice>{state.error}</Notice> : null}
    </form>
  );
}

/** Approve, or turn down with a reason. */
export function DecideForms({ id }: { id: string }) {
  return (
    <div className="mt-3 space-y-2">
      <OneClick id={id} action={approveRequest} label="Approve and run it" />
      <NoteForm
        id={id}
        action={rejectRequest}
        placeholder="Why it shouldn't go ahead"
        buttons={[{ label: 'Turn down', kind: 'secondary' }]}
      />
    </div>
  );
}

export function CancelForm({ id }: { id: string }) {
  return (
    <div className="mt-3">
      <OneClick id={id} action={cancelRequest} label="Take it back" kind="secondary" />
    </div>
  );
}
