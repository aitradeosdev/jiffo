'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { reasonMissing } from '@/lib/reason';
import { Field, inputClass } from './ui';

const Reason = createContext<{
  reason: string;
  setReason: (r: string) => void;
  /** A change was refused for want of a reason: the box asks for one, and is brought into view. */
  missing: number;
  setMissing: (m: number) => void;
}>({
  reason: '',
  setReason: () => undefined,
  missing: 0,
  setMissing: () => undefined,
});

/**
 * Every change says why (docs/security-plan.md, D7). A page whose forms carry no note of their own has one
 * box for the reason, and every form on it sends what is typed there. A reason is for one change: the box
 * empties once a change goes through, and on moving to another page or tab, so a later change can't carry it
 * unnoticed.
 */
export function ReasonProvider({ children }: { children: ReactNode }) {
  const at = `${usePathname()}?${useSearchParams().toString()}`;
  const [reason, setReason] = useState('');
  const [missing, setMissing] = useState(0);
  const [seen, setSeen] = useState(at);
  if (seen !== at) {
    setSeen(at);
    setReason('');
    setMissing(0);
  }
  return <Reason.Provider value={{ reason, setReason, missing, setMissing }}>{children}</Reason.Provider>;
}

/** The box, at the top of the page. */
export function ReasonBox() {
  const { reason, setReason, missing, setMissing } = useContext(Reason);
  const box = useRef<HTMLInputElement>(null);
  // Refused for want of a reason: brought into view from wherever the form was, ready to type in.
  useEffect(() => {
    if (!missing) return;
    box.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    box.current?.focus({ preventScroll: true });
  }, [missing]);
  return (
    <Field
      label="Why are you making this change?"
      hint={
        missing
          ? 'Say why here first, in a few words, then press the button again.'
          : 'Kept in the audit log with the change. Each change asks again.'
      }
    >
      <input
        ref={box}
        value={reason}
        onChange={(e) => {
          setReason(e.currentTarget.value);
          if (missing) setMissing(0);
        }}
        maxLength={1000}
        placeholder="For example: New category for the Lagos launch"
        aria-invalid={missing ? true : undefined}
        className={`${inputClass}${missing ? ' border-danger ring-2 ring-danger/30' : ''}`}
      />
    </Field>
  );
}

/**
 * Inside each form: sends the page's reason with it. `after` is the form's action result: one without an error
 * means the change went through, and its reason is spent.
 */
export function ReasonInput({ after }: { after?: { error?: string } }) {
  const { reason, setReason, setMissing } = useContext(Reason);
  const initial = useRef(after);
  useEffect(() => {
    if (!after || after === initial.current) return;
    if (!after.error) setReason('');
    // Each refusal points to the box afresh, even a second one in a row.
    else if (reasonMissing(after, reason)) setMissing(Date.now());
    // Only when the form's result changes: typing in the box isn't a new result.
  }, [after, setReason, setMissing]);
  return <input type="hidden" name="reason" value={reason} />;
}
