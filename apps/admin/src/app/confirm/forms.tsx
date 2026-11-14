'use client';

import { useActionState } from 'react';
import { PasskeyButton } from '@/components/passkey-button';
import { SubmitButton } from '@/components/submit-button';
import { Field, inputClass, Notice } from '@/components/ui';
import { confirmOptions, confirmWithCode, confirmWithPasskey, type ConfirmState } from './actions';

export function ConfirmPasskey({ back }: { back: string }) {
  return (
    <PasskeyButton label="Confirm with passkey" options={confirmOptions} finish={(r) => confirmWithPasskey(r, back)} />
  );
}

export function ConfirmCode({ back }: { back: string }) {
  const [state, action] = useActionState<ConfirmState, FormData>(confirmWithCode, {});
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="back" value={back} />
      <Field label="Code from your authenticator app">
        <input
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          required
          minLength={6}
          maxLength={10}
          autoFocus
          className={inputClass}
        />
      </Field>
      <Notice>{state.error}</Notice>
      <SubmitButton className="w-full" pendingLabel="Checking…">
        Confirm
      </SubmitButton>
    </form>
  );
}
