'use client';

import { startAuthentication, type PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';
import { useState } from 'react';
import { buttonClass, Notice } from './ui';

/**
 * Asks the browser for the admin's passkey and hands its answer on. The options come fresh each time, since
 * each request can be answered once.
 */
export function PasskeyButton({
  label,
  options,
  finish,
}: {
  label: string;
  options: () => Promise<{ options?: PublicKeyCredentialRequestOptionsJSON; error?: string }>;
  finish: (response: Awaited<ReturnType<typeof startAuthentication>>) => Promise<{ error?: string } | void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  return (
    <div className="space-y-3">
      <button
        type="button"
        className={`${buttonClass('primary')} w-full`}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(undefined);
          try {
            const asked = await options();
            if (!asked.options) throw new Error(asked.error ?? 'Try again.');
            const answer = await startAuthentication({ optionsJSON: asked.options });
            const done = await finish(answer);
            if (done?.error) setError(done.error);
          } catch (e) {
            // The person cancelled, or the browser couldn't use a passkey here.
            const name = (e as { name?: string }).name;
            setError(
              name === 'NotAllowedError'
                ? 'The passkey request was cancelled or timed out. Try again.'
                : (e as Error).message,
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? 'Waiting for your passkey…' : label}
      </button>
      <Notice>{error}</Notice>
    </div>
  );
}
