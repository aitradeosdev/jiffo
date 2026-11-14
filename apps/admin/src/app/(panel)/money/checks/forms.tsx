'use client';

import { useActionState, useState } from 'react';
import { SubmitButton } from '@/components/submit-button';
import { inputClass, Notice } from '@/components/ui';
import { clearCheck, resolveAlert, type CheckState } from './actions';

/** A note and a button: clears a check, or resolves an alert. The note is kept if the action is refused. */
function NoteForm({
  id,
  action,
  label,
  placeholder,
}: {
  id: string;
  action: (state: CheckState, form: FormData) => Promise<CheckState>;
  label: string;
  placeholder: string;
}) {
  const [state, submit] = useActionState<CheckState, FormData>(action, {});
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
          placeholder={placeholder}
          className={inputClass}
        />
      </label>
      <SubmitButton pendingLabel="Saving…">{label}</SubmitButton>
      {state.error ? <Notice>{state.error}</Notice> : null}
    </form>
  );
}

export function ClearCheckForm({ id }: { id: string }) {
  return (
    <NoteForm
      id={id}
      action={clearCheck}
      label="Clear and restart instant withdrawals"
      placeholder="What explained the gap, and what was done"
    />
  );
}

export function ResolveAlertForm({ id }: { id: string }) {
  return <NoteForm id={id} action={resolveAlert} label="Resolve" placeholder="What was found or done" />;
}
