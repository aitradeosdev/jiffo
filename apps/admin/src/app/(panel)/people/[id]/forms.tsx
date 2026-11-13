'use client';

import Link from 'next/link';
import { agentTierLabel } from '@jiffo/shared';
import { useActionState, useState } from 'react';
import { SubmitButton } from '@/components/submit-button';
import { buttonClass, inputClass, Notice } from '@/components/ui';
import { changeAccess, decideApplication, setTier, type PersonState } from './actions';

export interface TierTerms {
  tier: string;
  commissionBps: number;
  holdHours: number;
}

/** "15% commission · earnings held 24 h", from the country's current settings. */
const about = (t: TierTerms) =>
  `${t.commissionBps / 100}% commission · ${t.holdHours ? `earnings held ${t.holdHours} h` : 'earnings at once'}`;

/** A reason box that keeps its text when the action is refused. */
function Reason({ label = 'Why', placeholder }: { label?: string; placeholder: string }) {
  const [note, setNote] = useState('');
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-semibold">{label}</span>
      <textarea
        name="note"
        required
        minLength={5}
        maxLength={1000}
        rows={2}
        value={note}
        onChange={(e) => setNote(e.currentTarget.value)}
        placeholder={placeholder}
        className={`${inputClass} h-auto py-2.5`}
      />
    </label>
  );
}

export function TierForm({ id, tier, tiers }: { id: string; tier: string; tiers: TierTerms[] }) {
  const [state, action] = useActionState<PersonState, FormData>(setTier, {});
  const [chosen, setChosen] = useState(tier);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="id" value={id} />
      <fieldset className="grid grid-cols-2 gap-2">
        <legend className="sr-only">Tier</legend>
        {tiers.map((t) => (
          <label
            key={t.tier}
            className="flex cursor-pointer flex-col rounded-xl border-2 border-line p-2.5 has-[:checked]:border-ink"
          >
            <span className="flex items-center gap-2 text-sm font-bold">
              <input
                type="radio"
                name="tier"
                value={t.tier}
                checked={chosen === t.tier}
                onChange={() => setChosen(t.tier)}
                className="accent-current"
              />
              {agentTierLabel(t.tier)}
            </span>
            <span className="mt-0.5 text-[12px] text-ink-3">{about(t)}</span>
          </label>
        ))}
      </fieldset>
      {chosen !== tier ? (
        <>
          <Reason label="Why change their tier" placeholder="For example: 50 errands with 4.9 stars and no disputes" />
          <Notice>{state.error}</Notice>
          <SubmitButton small pendingLabel="Saving…">
            Change tier
          </SubmitButton>
        </>
      ) : null}
    </form>
  );
}

export function AccessForm({ id, suspended }: { id: string; suspended: boolean }) {
  const [state, action] = useActionState<PersonState, FormData>(changeAccess, {});
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button
        type="button"
        className={buttonClass(suspended ? 'secondary' : 'danger', true)}
        onClick={() => setOpen(true)}
      >
        {suspended ? 'Reactivate account' : 'Suspend account'}
      </button>
    );
  }
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="what" value={suspended ? 'reactivate' : 'suspend'} />
      <p className="text-sm text-ink-2">
        {suspended
          ? 'They can sign in and use Jiffo again.'
          : 'Signs them out everywhere and stops them using Jiffo. Errands still waiting for an agent are closed; errands in progress must be settled first.'}
      </p>
      <Reason placeholder={suspended ? 'What changed' : 'What happened'} />
      <Notice>
        {state.error}
        {state.errandIds?.length ? (
          <span className="mt-1 block">
            {state.errandIds.map((e, i) => (
              <Link key={e} href={`/errands/${e}`} className="mr-2 underline">
                Errand {i + 1}
              </Link>
            ))}
          </span>
        ) : null}
      </Notice>
      <div className="flex gap-2">
        <SubmitButton kind={suspended ? 'primary' : 'danger'} small pendingLabel="Saving…">
          {suspended ? 'Yes, reactivate' : 'Yes, suspend'}
        </SubmitButton>
        <button type="button" className={buttonClass('ghost', true)} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** Approve or decline an application the checks sent to review; each asks for a reason first. */
export function DecisionForm({ id }: { id: string }) {
  const [state, action] = useActionState<PersonState, FormData>(decideApplication, {});
  const [decision, setDecision] = useState<'approve' | 'reject' | null>(null);
  if (!decision) {
    return (
      <div className="flex flex-wrap gap-2">
        <button type="button" className={buttonClass('primary', true)} onClick={() => setDecision('approve')}>
          Approve
        </button>
        <button type="button" className={buttonClass('danger', true)} onClick={() => setDecision('reject')}>
          Decline
        </button>
      </div>
    );
  }
  const approve = decision === 'approve';
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="decision" value={decision} />
      <p className="text-sm text-ink-2">
        {approve
          ? 'They can go online and take errands straight away, and are told so.'
          : 'They can’t take errands. They see your reason in the app, so write it to them.'}
      </p>
      <Reason
        key={decision}
        label={approve ? 'Why approve' : 'What to tell them'}
        placeholder={
          approve
            ? 'For example: the selfie result was unclear; the provider’s photo match is fine on a second look'
            : 'For example: the selfie is of a different person from the NIN photo'
        }
      />
      <Notice>{state.error}</Notice>
      <div className="flex gap-2">
        <SubmitButton kind={approve ? 'primary' : 'danger'} small pendingLabel="Saving…">
          {approve ? 'Yes, approve' : 'Yes, decline'}
        </SubmitButton>
        <button type="button" className={buttonClass('ghost', true)} onClick={() => setDecision(null)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
