'use client';

import { startRegistration } from '@simplewebauthn/browser';
import { useState } from 'react';
import { buttonClass, Field, inputClass, Notice } from '@/components/ui';
import { addPasskey, registrationOptions } from './actions';

export function AddPasskey() {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  return (
    <div className="space-y-4">
      <Field label="Name it" hint="So you can tell your passkeys apart, such as Work laptop or My phone.">
        <input value={name} onChange={(e) => setName(e.currentTarget.value)} maxLength={60} className={inputClass} />
      </Field>
      <button
        type="button"
        className={`${buttonClass('primary')} w-full`}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(undefined);
          try {
            const asked = await registrationOptions();
            if (!asked.options) throw new Error(asked.error ?? 'Try again.');
            const made = await startRegistration({ optionsJSON: asked.options });
            const done = await addPasskey(made, name);
            if (done?.error) setError(done.error);
          } catch (e) {
            const kind = (e as { name?: string }).name;
            setError(
              kind === 'NotAllowedError'
                ? 'The passkey request was cancelled or timed out. Try again.'
                : kind === 'InvalidStateError'
                  ? 'This device already has a passkey for you.'
                  : (e as Error).message,
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? 'Waiting for your device…' : 'Add a passkey'}
      </button>
      <Notice>{error}</Notice>
    </div>
  );
}
