'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';
import { Field, inputClass } from './ui';

const Reason = createContext<{ reason: string; setReason: (r: string) => void }>({
  reason: '',
  setReason: () => undefined,
});

/**
 * Every change says why (docs/security-plan.md, D7). A page whose forms carry no note of their own has one
 * box for the reason, and every form on it sends what is typed there.
 */
export function ReasonProvider({ children }: { children: ReactNode }) {
  const [reason, setReason] = useState('');
  return <Reason.Provider value={{ reason, setReason }}>{children}</Reason.Provider>;
}

/** The box, at the top of the page. */
export function ReasonBox() {
  const { reason, setReason } = useContext(Reason);
  return (
    <Field label="Why are you making these changes?" hint="Kept in the audit log with each change.">
      <input
        value={reason}
        onChange={(e) => setReason(e.currentTarget.value)}
        maxLength={500}
        placeholder="For example: New category for the Lagos launch"
        className={inputClass}
      />
    </Field>
  );
}

/** Inside each form: sends the page's reason with it. */
export function ReasonInput() {
  return <input type="hidden" name="reason" value={useContext(Reason).reason} />;
}
