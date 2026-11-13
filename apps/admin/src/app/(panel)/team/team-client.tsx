'use client';

import { useActionState, useState } from 'react';
import { SubmitButton } from '@/components/submit-button';
import { buttonClass, Field, inputClass, Notice } from '@/components/ui';
import { inviteTeammate, resetTeammate, updateTeammate, type TeamState } from './actions';
import { ROLES } from './roles';

/** A new invite link, shown once, with a button to copy it. */
function InviteLink({ url, email }: { url: string; email?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-xl bg-brand-soft p-3.5 text-brand-ink" role="status">
      <p className="text-sm font-semibold">
        Send this link to {email || 'them'}. It works once, for 72 hours, and won&apos;t be shown again.
      </p>
      <div className="mt-2 flex gap-2">
        <input
          readOnly
          value={url}
          aria-label="Invite link"
          onFocus={(e) => e.currentTarget.select()}
          className="h-9 min-w-0 flex-1 rounded-lg bg-surface px-2.5 font-mono text-xs text-ink"
        />
        <button
          type="button"
          className={buttonClass('primary', true)}
          onClick={async () => {
            await navigator.clipboard.writeText(url);
            setCopied(true);
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

export function InviteForm() {
  const [state, action] = useActionState<TeamState, FormData>(inviteTeammate, {});
  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name">
          <input
            name="name"
            required
            maxLength={80}
            autoComplete="off"
            defaultValue={state.typed?.name}
            className={inputClass}
          />
        </Field>
        <Field label="Work email">
          <input
            name="email"
            type="email"
            required
            autoComplete="off"
            defaultValue={state.typed?.email}
            className={inputClass}
          />
        </Field>
      </div>
      <fieldset>
        <legend className="mb-1.5 text-sm font-semibold">Role</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {ROLES.map((r) => (
            <label
              key={r.value}
              className="flex cursor-pointer items-start gap-2.5 rounded-xl border-2 border-line p-3 has-[:checked]:border-ink"
            >
              <input
                type="radio"
                name="role"
                value={r.value}
                required
                defaultChecked={r.value === (state.typed?.role ?? 'support')}
                className="mt-1 accent-current"
              />
              <span>
                <span className="block text-sm font-bold">{r.label}</span>
                <span className="block text-[13px] text-ink-3">{r.about}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <Notice>{state.error}</Notice>
      {state.inviteUrl ? <InviteLink url={state.inviteUrl} email={state.forEmail} /> : null}
      <SubmitButton pendingLabel="Inviting…">Send invite</SubmitButton>
    </form>
  );
}

interface Member {
  id: string;
  email: string;
  role: string;
  status: 'invited' | 'active' | 'disabled';
}

/** A teammate's role picker and access buttons. Disabling and resetting ask first. */
export function MemberActions({ member }: { member: Member }) {
  const [confirming, setConfirming] = useState<'disable' | 'reset' | null>(null);
  // The question closes once the answer is back, so the button keeps showing it is working until then.
  const answered =
    (run: (state: TeamState, form: FormData) => Promise<TeamState>) => async (state: TeamState, form: FormData) => {
      const result = await run(state, form);
      setConfirming(null);
      return result;
    };
  const [roleState, roleAction] = useActionState<TeamState, FormData>(updateTeammate, {});
  const [statusState, statusAction] = useActionState<TeamState, FormData>(answered(updateTeammate), {});
  const [resetState, resetAction] = useActionState<TeamState, FormData>(answered(resetTeammate), {});
  const error = roleState.error || statusState.error || resetState.error;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <form action={roleAction}>
          <input type="hidden" name="id" value={member.id} />
          <label className="sr-only" htmlFor={`role-${member.id}`}>
            Role for {member.email}
          </label>
          {/* Keyed by the role, so the picker shows the saved role again after the page refreshes. */}
          <select
            key={member.role}
            id={`role-${member.id}`}
            name="role"
            defaultValue={member.role}
            disabled={member.status === 'disabled'}
            onChange={(e) => e.currentTarget.form?.requestSubmit()}
            className="h-9 rounded-full bg-surface-2 px-3 text-sm font-semibold disabled:opacity-50"
          >
            {ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </form>

        {member.status === 'disabled' ? (
          <form action={statusAction}>
            <input type="hidden" name="id" value={member.id} />
            <input type="hidden" name="status" value="active" />
            <SubmitButton kind="secondary" small>
              Enable
            </SubmitButton>
          </form>
        ) : confirming === 'disable' ? (
          <form action={statusAction} className="flex gap-1">
            <input type="hidden" name="id" value={member.id} />
            <input type="hidden" name="status" value="disabled" />
            <SubmitButton kind="danger" small>
              Yes, disable
            </SubmitButton>
            <button type="button" className={buttonClass('ghost', true)} onClick={() => setConfirming(null)}>
              Keep
            </button>
          </form>
        ) : (
          <button type="button" className={buttonClass('secondary', true)} onClick={() => setConfirming('disable')}>
            Disable
          </button>
        )}

        {member.status === 'disabled' ? null : confirming === 'reset' ? (
          <form action={resetAction} className="flex gap-1">
            <input type="hidden" name="id" value={member.id} />
            <input type="hidden" name="email" value={member.email} />
            <SubmitButton kind="danger" small>
              Yes, reset
            </SubmitButton>
            <button type="button" className={buttonClass('ghost', true)} onClick={() => setConfirming(null)}>
              Keep
            </button>
          </form>
        ) : (
          <button
            type="button"
            className={buttonClass('secondary', true)}
            onClick={() => setConfirming('reset')}
            title="Clears their password and authenticator app and makes a new invite link"
          >
            {member.status === 'invited' ? 'New link' : 'Reset access'}
          </button>
        )}
      </div>
      {confirming === 'reset' ? (
        <p className="text-right text-[13px] text-ink-3">
          Clears their password and authenticator app, signs them out and makes a new invite link.
        </p>
      ) : null}
      {confirming === 'disable' ? (
        <p className="text-right text-[13px] text-ink-3">
          Signs them out now. They can&apos;t sign in until enabled again.
        </p>
      ) : null}
      <Notice>{error}</Notice>
      {resetState.inviteUrl ? <InviteLink url={resetState.inviteUrl} email={resetState.forEmail} /> : null}
    </div>
  );
}
