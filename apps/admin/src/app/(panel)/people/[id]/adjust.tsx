'use client';

import { useActionState, useState } from 'react';
import { SubmitButton } from '@/components/submit-button';
import { buttonClass, inputClass, Notice } from '@/components/ui';
import { money, nairaToKobo } from '@/lib/format';
import { adjustBalance, type PersonState } from './actions';

/**
 * A credit (paid by Jiffo) or debit on the person's wallet or agent balance, with a reason. The request id is
 * made once per form, so submitting twice moves the money once.
 */
export function AdjustForm({
  id,
  currency,
  accounts,
  errands,
}: {
  id: string;
  currency: string;
  accounts: Array<{ value: 'customer_wallet' | 'agent_available'; label: string; balanceKobo: number }>;
  errands: Array<{ id: string; description: string }>;
}) {
  const [state, action] = useActionState<PersonState, FormData>(adjustBalance, {});
  const [requestId] = useState(() => crypto.randomUUID());
  const [account, setAccount] = useState(accounts[0]!.value);
  const [direction, setDirection] = useState<'credit' | 'debit'>('credit');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [errandId, setErrandId] = useState('');
  const [confirming, setConfirming] = useState(false);
  const kobo = nairaToKobo(amount);
  const chosen = accounts.find((a) => a.value === account)!;
  const valid = kobo > 0 && note.trim().length >= 5;

  return (
    <form
      action={action}
      className="space-y-3"
      onChange={() => setConfirming(false)}
      // Enter in a field would submit at once; it only ever opens the confirmation instead.
      onSubmit={(e) => {
        if (!confirming) {
          e.preventDefault();
          if (valid) setConfirming(true);
        }
      }}
    >
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="requestId" value={requestId} />
      {accounts.length > 1 ? (
        <label className="block">
          <span className="mb-1.5 block text-sm font-semibold">Account</span>
          <select
            name="account"
            value={account}
            onChange={(e) => setAccount(e.currentTarget.value as typeof account)}
            className={inputClass}
          >
            {accounts.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <input type="hidden" name="account" value={account} />
      )}
      <p className="text-[13px] text-ink-3">
        {chosen.label} holds {money(chosen.balanceKobo, currency)}.
      </p>
      <div className="flex gap-1.5" role="radiogroup" aria-label="Credit or debit">
        {(['credit', 'debit'] as const).map((d) => (
          <label
            key={d}
            className={`cursor-pointer rounded-full px-3 py-1.5 text-sm font-semibold ${
              direction === d ? 'bg-ink text-on-ink' : 'bg-surface-2 text-ink-2'
            }`}
          >
            <input
              type="radio"
              name="direction"
              value={d}
              checked={direction === d}
              onChange={() => setDirection(d)}
              className="sr-only"
            />
            {d === 'credit' ? 'Add money' : 'Take money back'}
          </label>
        ))}
      </div>
      <label className="block">
        <span className="mb-1.5 block text-sm font-semibold">Amount</span>
        <span className="flex items-center rounded-xl bg-surface-2 px-3">
          <span className="text-ink-3">₦</span>
          <input
            name="amount"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.currentTarget.value)}
            className="num h-11 w-full bg-transparent px-1.5 text-[15px] focus:outline-none"
          />
        </span>
      </label>
      {errands.length ? (
        <label className="block">
          <span className="mb-1.5 block text-sm font-semibold">For an errand (optional)</span>
          <select
            name="errandId"
            value={errandId}
            onChange={(e) => setErrandId(e.currentTarget.value)}
            className={inputClass}
          >
            <option value="">None</option>
            {errands.map((e) => (
              <option key={e.id} value={e.id}>
                {e.description.length > 60 ? `${e.description.slice(0, 57)}…` : e.description}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label className="block">
        <span className="mb-1.5 block text-sm font-semibold">Reason for the adjustment</span>
        <textarea
          name="note"
          required
          minLength={5}
          maxLength={1000}
          rows={2}
          value={note}
          onChange={(e) => setNote(e.currentTarget.value)}
          placeholder={
            direction === 'credit'
              ? 'For example: goodwill for a delivery two hours late'
              : 'For example: recovering a double payment'
          }
          className={`${inputClass} h-auto py-2.5`}
        />
      </label>
      <p className="text-[13px] text-ink-3">
        {direction === 'credit' ? 'Jiffo pays this out of its revenue.' : 'This goes back into Jiffo’s revenue.'} It
        shows in their history as an adjustment by Jiffo support.
      </p>
      <Notice>{state.error}</Notice>
      {confirming ? (
        <div className="flex gap-2">
          <SubmitButton kind={direction === 'debit' ? 'danger' : 'primary'} small pendingLabel="Saving…">
            Yes, {direction === 'credit' ? 'add' : 'take back'} {Number.isNaN(kobo) ? '' : money(kobo, currency)}
          </SubmitButton>
          <button type="button" className={buttonClass('ghost', true)} onClick={() => setConfirming(false)}>
            Back
          </button>
        </div>
      ) : (
        <button
          type="button"
          className={buttonClass('secondary', true)}
          disabled={!valid}
          onClick={() => setConfirming(true)}
        >
          Continue
        </button>
      )}
    </form>
  );
}
