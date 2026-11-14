'use client';

import type { ReactNode } from 'react';
import { useFormStatus } from 'react-dom';
import { buttonClass } from './ui';

/** A form's submit button that shows it is working and can't be pressed twice. */
export function SubmitButton({
  children,
  kind = 'primary',
  small,
  className,
  pendingLabel,
  name,
  value,
}: {
  children: ReactNode;
  kind?: 'primary' | 'secondary' | 'danger';
  small?: boolean;
  className?: string;
  pendingLabel?: string;
  /** Sent with the form when this button submits it, to tell two buttons apart. */
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name={name}
      value={value}
      disabled={pending}
      aria-busy={pending}
      className={`${buttonClass(kind, small)} ${className ?? ''}`}
    >
      {pending && pendingLabel ? pendingLabel : children}
    </button>
  );
}
