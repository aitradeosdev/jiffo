'use client';

import { useActionState } from 'react';
import { SubmitButton } from '@/components/submit-button';
import { Field, inputClass, Notice } from '@/components/ui';
import { signIn, verifyCode, type FormState } from './actions';

export function SignInForm() {
  const [state, action] = useActionState<FormState, FormData>(signIn, {});
  return (
    <form action={action} className="space-y-4">
      <Field label="Work email">
        <input
          name="email"
          type="email"
          required
          autoComplete="username"
          autoFocus={!state.email}
          defaultValue={state.email}
          className={inputClass}
        />
      </Field>
      <Field label="Password">
        <input
          name="password"
          type="password"
          required
          autoComplete="current-password"
          autoFocus={!!state.email}
          className={inputClass}
        />
      </Field>
      <Notice>{state.error}</Notice>
      <SubmitButton className="w-full" pendingLabel="Checking…">
        Continue
      </SubmitButton>
    </form>
  );
}

export function CodeForm({ label = 'Continue' }: { label?: string }) {
  const [state, action] = useActionState<FormState, FormData>(verifyCode, {});
  return (
    <form action={action} className="space-y-4">
      <Field label="6-digit code" hint="From your authenticator app. A new code appears every 30 seconds.">
        <input
          name="code"
          required
          autoFocus
          autoComplete="one-time-code"
          inputMode="numeric"
          pattern="[0-9 ]{6,7}"
          maxLength={7}
          className={`${inputClass} num text-center text-xl tracking-[0.4em]`}
        />
      </Field>
      <Notice>{state.error}</Notice>
      <SubmitButton className="w-full" pendingLabel="Checking…">
        {label}
      </SubmitButton>
    </form>
  );
}
