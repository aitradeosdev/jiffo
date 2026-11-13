'use client';

import { useActionState, useEffect, useState } from 'react';
import { SubmitButton } from '@/components/submit-button';
import { Field, inputClass, Notice } from '@/components/ui';
import { acceptInvite, readInvite, type InviteInfo } from './actions';

const ROLE: Record<string, string> = {
  owner: 'an owner',
  operations: 'operations',
  finance: 'finance',
  support: 'support',
};

/**
 * The invite token is in the link's #fragment, which browsers never send to a server or put in logs. It is
 * read here, then taken out of the address bar.
 */
export function InviteForm() {
  const [token, setToken] = useState<string | null>(null);
  const [info, setInfo] = useState<{ invite?: InviteInfo; error?: string } | null>(null);
  const [state, action] = useActionState(acceptInvite, {});

  useEffect(() => {
    const found = window.location.hash.slice(1);
    window.history.replaceState(null, '', window.location.pathname);
    if (!found) {
      setInfo({ error: 'This link is missing its code. Open the link from your invite again.' });
      return;
    }
    setToken(found);
    readInvite(found).then(setInfo);
  }, []);

  if (!info) return <p className="text-ink-3">Checking your invite…</p>;
  if (!info.invite) return <Notice>{info.error}</Notice>;
  return (
    <>
      <h1 className="text-2xl font-extrabold tracking-tight">Welcome, {info.invite.name.split(' ')[0]}</h1>
      <p className="mt-1 mb-6 text-[15px] text-ink-3">
        You&apos;re joining the Jiffo team as {ROLE[info.invite.role] ?? info.invite.role}. Choose a password for{' '}
        <span className="font-semibold text-ink">{info.invite.email}</span>.
      </p>
      <form action={action} className="space-y-4">
        <input type="hidden" name="token" value={token ?? ''} />
        {/* For password managers, so they save the new password against the right email. */}
        <input type="email" name="username" value={info.invite.email} autoComplete="username" readOnly hidden />
        <Field label="Password" hint="At least 12 characters. A password manager can make one for you.">
          <input
            name="password"
            type="password"
            required
            minLength={12}
            autoComplete="new-password"
            autoFocus
            className={inputClass}
          />
        </Field>
        <Field label="Password again">
          <input
            name="confirm"
            type="password"
            required
            minLength={12}
            autoComplete="new-password"
            className={inputClass}
          />
        </Field>
        <Notice>{state.error}</Notice>
        <SubmitButton className="w-full" pendingLabel="Saving…">
          Set password
        </SubmitButton>
      </form>
    </>
  );
}
