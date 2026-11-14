'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Field, inputClass } from './ui';

const Reason = createContext<{ reason: string; setReason: (r: string) => void }>({
  reason: '',
  setReason: () => undefined,
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
  const [seen, setSeen] = useState(at);
  if (seen !== at) {
    setSeen(at);
    setReason('');
  }
  return <Reason.Provider value={{ reason, setReason }}>{children}</Reason.Provider>;
}

/** The box, at the top of the page. */
export function ReasonBox() {
  const { reason, setReason } = useContext(Reason);
  return (
    <Field
      label="Why are you making this change?"
      hint="Kept in the audit log with the change. Each change asks again."
    >
      <input
        value={reason}
        onChange={(e) => setReason(e.currentTarget.value)}
        maxLength={1000}
        placeholder="For example: New category for the Lagos launch"
        className={inputClass}
      />
    </Field>
  );
}

/**
 * Inside each form: sends the page's reason with it. `after` is the form's action result: one without an error
 * means the change went through, and its reason is spent.
 */
export function ReasonInput({ after }: { after?: { error?: string } }) {
  const { reason, setReason } = useContext(Reason);
  const initial = useRef(after);
  useEffect(() => {
    if (after && after !== initial.current && !after.error) setReason('');
  }, [after, setReason]);
  return <input type="hidden" name="reason" value={reason} />;
}
