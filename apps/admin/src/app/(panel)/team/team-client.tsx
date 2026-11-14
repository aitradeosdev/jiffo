'use client';

import { ReasonInput } from '@/components/reason';
import { useActionState, useState } from 'react';
import { SubmitButton } from '@/components/submit-button';
import { buttonClass, Field, inputClass, Notice } from '@/components/ui';
import { inviteTeammate, resetTeammate, updateTeammate, type TeamState } from './actions';
import { ROLES } from './roles';

/** Where the link went. It is never shown here, so only the teammate can use it. */
function Emailed({ to, hours }: { to: string; hours: number }) {
  return (
    <p className="rounded-xl bg-brand-soft p-3.5 text-sm font-semibold text-brand-ink" role="status">
      We&apos;ve emailed a link to {to}. It works once, for {hours} hours. If it doesn&apos;t arrive, reset their access
      to send a new one.
    </p>
  );
}

export function InviteForm() {
  const [state, action] = useActionState<TeamState, FormData>(inviteTeammate, {});
  return (
    <form action={action} className="space-y-4">
      <ReasonInput after={state} />
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
        <Field
          label="Their own phone number"
          hint="The number they use, or would use, in the Jiffo apps. They can't change that account from the panel."
        >
          <input
            name="phone"
            type="tel"
            required
            maxLength={30}
            autoComplete="off"
            placeholder="0803 123 4567"
            defaultValue={state.typed?.phone}
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
      {state.emailed ? <Emailed to={state.emailed.to} hours={state.emailed.hours} /> : null}
      <SubmitButton pendingLabel="Inviting…">Send invite</SubmitButton>
    </form>
  );
}

interface Member {
  id: string;
  email: string;
  role: string;
  status: 'invited' | 'active' | 'disabled';
  /** Masked; none means they can't change people's accounts yet. */
  phone: string | null;
}

/** A teammate's role picker and access buttons. Disabling and resetting ask first. */
export function MemberActions({ member }: { member: Member }) {
  const [confirming, setConfirming] = useState<'disable' | 'reset' | 'phone' | null>(null);
  // Held in state: React clears a form's fields after its action, which would lose a number that was refused.
  const [phoneTyped, setPhoneTyped] = useState('');
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
  // Not closed on an answer: a number that is refused stays there to correct. One that is taken waits for a
  // second owner, and the page moves to the Approvals page.
  const [phoneState, phoneAction] = useActionState<TeamState, FormData>(updateTeammate, {});
  const error = roleState.error || statusState.error || resetState.error || phoneState.error;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <form action={roleAction}>
          <ReasonInput after={roleState} />
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
            <ReasonInput after={statusState} />
            <input type="hidden" name="id" value={member.id} />
            <input type="hidden" name="status" value="active" />
            <SubmitButton kind="secondary" small>
              Enable
            </SubmitButton>
          </form>
        ) : confirming === 'disable' ? (
          <form action={statusAction} className="flex gap-1">
            <ReasonInput after={statusState} />
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
            <ReasonInput after={resetState} />
            <input type="hidden" name="id" value={member.id} />
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
      {confirming === 'phone' ? (
        <form action={phoneAction} className="flex flex-wrap items-center justify-end gap-1">
          <ReasonInput after={phoneState} />
          <input type="hidden" name="id" value={member.id} />
          <label className="sr-only" htmlFor={`phone-${member.id}`}>
            Phone number for {member.email}
          </label>
          <input
            id={`phone-${member.id}`}
            name="phone"
            type="tel"
            required
            maxLength={30}
            autoComplete="off"
            placeholder="0803 123 4567"
            value={phoneTyped}
            onChange={(e) => setPhoneTyped(e.currentTarget.value)}
            className={`${inputClass} h-9 max-w-[200px]`}
          />
          <SubmitButton small>Save</SubmitButton>
          <button type="button" className={buttonClass('ghost', true)} onClick={() => setConfirming(null)}>
            Cancel
          </button>
        </form>
      ) : member.status === 'disabled' ? null : (
        <div className="flex justify-end">
          <button type="button" className={buttonClass('ghost', true)} onClick={() => setConfirming('phone')}>
            {member.phone ? 'Change phone number' : 'Add phone number'}
          </button>
        </div>
      )}
      {confirming === 'phone' ? (
        <p className="text-right text-[13px] text-ink-3">The number waits for a second owner.</p>
      ) : null}
      {confirming === 'reset' ? (
        <p className="text-right text-[13px] text-ink-3">
          Clears their password and authenticator app, signs them out and emails them a new link.
        </p>
      ) : null}
      {confirming === 'disable' ? (
        <p className="text-right text-[13px] text-ink-3">
          Signs them out now. They can&apos;t sign in until enabled again.
        </p>
      ) : null}
      <Notice>{error}</Notice>
      {resetState.emailed ? <Emailed to={resetState.emailed.to} hours={resetState.emailed.hours} /> : null}
    </div>
  );
}
