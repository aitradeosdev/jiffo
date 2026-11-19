'use client';

import { useActionState, useState } from 'react';
import { SubmitButton } from './submit-button';
import { inputClass, Notice } from './ui';

export interface NoteFormState {
  error?: string;
}

/**
 * A note saying why, and the buttons that act on one item with it. The note is kept if the action is
 * refused. Buttons with a value send it as "decision", for actions with more than one outcome.
 */
export function NoteForm({
  id,
  action,
  placeholder,
  buttons,
  noEnter = false,
}: {
  id: string;
  action: (state: NoteFormState, form: FormData) => Promise<NoteFormState>;
  placeholder: string;
  buttons: Array<{ label: string; value?: string; kind?: 'primary' | 'secondary' | 'danger' }>;
  /** Enter in the note sends nothing, so one of the buttons must be pressed: for choices that differ a lot. */
  noEnter?: boolean;
}) {
  const [state, submit] = useActionState<NoteFormState, FormData>(action, {});
  const [note, setNote] = useState('');
  return (
    <form action={submit} className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-start">
      <input type="hidden" name="id" value={id} />
      {/* Enter presses a form's first button; a disabled one there means Enter sends nothing. */}
      {noEnter ? <button type="submit" disabled hidden aria-hidden="true" tabIndex={-1} /> : null}
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
      {buttons.map((b) => (
        <SubmitButton
          key={b.label}
          name={b.value ? 'decision' : undefined}
          value={b.value}
          kind={b.kind}
          pendingLabel="Saving…"
        >
          {b.label}
        </SubmitButton>
      ))}
      {state.error ? <Notice>{state.error}</Notice> : null}
    </form>
  );
}
