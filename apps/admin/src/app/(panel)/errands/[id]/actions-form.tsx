'use client';

import { useActionState, useState } from 'react';
import { SubmitButton } from '@/components/submit-button';
import { buttonClass, inputClass, Notice } from '@/components/ui';
import { money, nairaToKobo } from '@/lib/format';
import { actOnErrand, type ActState } from './actions';

const ACTIONS: Record<string, { label: string; about: string }> = {
  admin_cancel: {
    label: 'Cancel errand',
    about: 'Closes it before any agent takes it. Nothing is held yet, so no money moves.',
  },
  admin_intervene: {
    label: 'Step in',
    about: 'Moves it into dispute and keeps the money held while you look into it.',
  },
  redeliver: { label: 'Arrange a redelivery', about: 'Back to the agent to deliver again, at the same fee.' },
  resolve_complete: { label: 'Settle as complete', about: 'The errand counts as done.' },
  resolve_cancel: { label: 'Settle as cancelled', about: 'The errand counts as not done.' },
};

export interface MoneyFacts {
  currency: string;
  heldFeeKobo: number;
  heldItemsKobo: number;
  /** Standard share-out of the fee at a hand-off. */
  agentKobo: number;
  jiffoKobo: number;
  /** Item amount the agent sent but the customer never locked, if any: chargeable from the wallet. */
  chargeableKobo: number;
  customerBalanceKobo: number;
}

/** Naira for the inputs: whole when it can be, never with a currency sign. */
const asInput = (kobo: number) => (kobo % 100 === 0 ? String(kobo / 100) : (kobo / 100).toFixed(2));

export function ActionsForm({
  id,
  version,
  actions,
  facts,
}: {
  id: string;
  version: number;
  actions: string[];
  facts: MoneyFacts;
}) {
  const [state, action] = useActionState<ActState, FormData>(actOnErrand, {});
  const [event, setEvent] = useState(actions[0] ?? '');
  const [mode, setMode] = useState<'standard' | 'custom'>('standard');
  const [agent, setAgent] = useState(asInput(facts.agentKobo));
  const [jiffo, setJiffo] = useState(asInput(facts.jiffoKobo));
  const [items, setItems] = useState(asInput(facts.heldItemsKobo));
  const [charge, setCharge] = useState('0');
  const [confirming, setConfirming] = useState(false);
  // Kept in state, so it survives a refused attempt: React clears uncontrolled fields after every action.
  const [note, setNote] = useState('');
  const naira = (kobo: number) => money(kobo, facts.currency);

  const resolving = event.startsWith('resolve_');
  const custom = resolving && mode === 'custom';
  const refund = facts.heldFeeKobo - nairaToKobo(agent) - nairaToKobo(jiffo);
  const itemsBack = facts.heldItemsKobo - nairaToKobo(items);
  const standardLine =
    event === 'resolve_complete'
      ? `Agent ${naira(facts.agentKobo)}, Jiffo ${naira(facts.jiffoKobo)}${
          facts.heldItemsKobo ? `, item money ${naira(facts.heldItemsKobo)} to the agent` : ''
        }. Nothing back to the customer.`
      : `Everything held goes back to the customer: ${naira(facts.heldFeeKobo + facts.heldItemsKobo)}.`;

  return (
    <form action={action} className="space-y-4" onChange={() => setConfirming(false)}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="version" value={version} />
      <fieldset className="space-y-2">
        <legend className="sr-only">What to do</legend>
        {actions.map((a) => (
          <label
            key={a}
            className="flex cursor-pointer items-start gap-2.5 rounded-xl border-2 border-line p-3 has-[:checked]:border-ink"
          >
            <input
              type="radio"
              name="event"
              value={a}
              checked={event === a}
              onChange={() => setEvent(a)}
              className="mt-1 accent-current"
            />
            <span>
              <span className="block text-sm font-bold">{ACTIONS[a]?.label ?? a}</span>
              <span className="block text-[13px] text-ink-3">{ACTIONS[a]?.about}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {resolving ? (
        <fieldset className="space-y-3 rounded-xl bg-surface-2 p-3.5">
          <legend className="sr-only">The money</legend>
          <div className="flex gap-1.5">
            {(['standard', 'custom'] as const).map((m) => (
              <label
                key={m}
                className={`cursor-pointer rounded-full px-3 py-1.5 text-sm font-semibold ${
                  mode === m ? 'bg-ink text-on-ink' : 'bg-surface text-ink-2'
                }`}
              >
                <input
                  type="radio"
                  name="money"
                  value={m}
                  checked={mode === m}
                  onChange={() => setMode(m)}
                  className="sr-only"
                />
                {m === 'standard' ? 'Standard' : 'Split by hand'}
              </label>
            ))}
          </div>
          {!custom ? (
            <p className="text-sm text-ink-2">{standardLine}</p>
          ) : (
            <div className="space-y-2.5">
              <Amount label="To the agent" name="agent" value={agent} onChange={setAgent} hint="From the fee held" />
              <Amount
                label="Kept by Jiffo"
                name="jiffo"
                value={jiffo}
                onChange={setJiffo}
                hint="Service fee and commission"
              />
              {facts.heldItemsKobo > 0 ? (
                <Amount
                  label="Item money to the agent"
                  name="items"
                  value={items}
                  onChange={setItems}
                  hint={`${naira(facts.heldItemsKobo)} held`}
                />
              ) : (
                <input type="hidden" name="items" value="0" />
              )}
              {facts.chargeableKobo > 0 ? (
                <Amount
                  label="Charge the customer for items"
                  name="charge"
                  value={charge}
                  onChange={setCharge}
                  hint={`Up to ${naira(facts.chargeableKobo)}, the amount they never locked. Their wallet holds ${naira(
                    facts.customerBalanceKobo,
                  )}.`}
                />
              ) : (
                <input type="hidden" name="charge" value="0" />
              )}
              <p className={`text-sm font-semibold ${refund < 0 || itemsBack < 0 ? 'text-danger' : 'text-ink'}`}>
                {refund < 0 || itemsBack < 0
                  ? `That's more than is held (${naira(facts.heldFeeKobo)} fee${
                      facts.heldItemsKobo ? `, ${naira(facts.heldItemsKobo)} items` : ''
                    }).`
                  : `Back to the customer: ${naira(refund + itemsBack)}`}
              </p>
            </div>
          )}
        </fieldset>
      ) : null}

      <label className="block">
        <span className="mb-1.5 block text-sm font-semibold">Why</span>
        <textarea
          name="note"
          value={note}
          onChange={(e) => setNote(e.currentTarget.value)}
          required
          minLength={5}
          maxLength={1000}
          rows={3}
          placeholder="What you checked and decided. Kept in the timeline and the audit log, not shown to the customer or agent."
          className={`${inputClass} h-auto py-2.5`}
        />
      </label>
      <Notice>{state.error}</Notice>
      {confirming ? (
        <div className="flex gap-2">
          <SubmitButton
            kind={event === 'resolve_cancel' || event === 'admin_cancel' ? 'danger' : 'primary'}
            pendingLabel="Saving…"
          >
            Yes, {ACTIONS[event]?.label.toLowerCase()}
          </SubmitButton>
          <button type="button" className={buttonClass('ghost')} onClick={() => setConfirming(false)}>
            Back
          </button>
        </div>
      ) : (
        <button type="button" className={buttonClass('primary')} onClick={() => setConfirming(true)} disabled={!event}>
          {ACTIONS[event]?.label ?? 'Continue'}
        </button>
      )}
    </form>
  );
}

function Amount({
  label,
  name,
  value,
  onChange,
  hint,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (v: string) => void;
  hint: string;
}) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between gap-2 text-sm font-semibold">
        {label}
        <span className="text-[12px] font-normal text-ink-3">{hint}</span>
      </span>
      <span className="mt-1 flex items-center rounded-xl bg-surface px-3">
        <span className="text-ink-3">₦</span>
        <input
          name={name}
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.currentTarget.value)}
          className="num h-10 w-full bg-transparent px-1.5 text-[15px] focus:outline-none"
        />
      </span>
    </label>
  );
}
