'use client';

import { useActionState, useState } from 'react';
import type { ProviderField } from '@jiffo/shared';
import { SubmitButton } from '@/components/submit-button';
import { Badge, buttonClass, inputClass, Notice } from '@/components/ui';
import {
  activateProvider,
  removeProvider,
  renewCallback,
  saveProvider,
  testProvider,
  type ProviderState,
} from './actions';

const FIXED_ACCOUNTS = {
  nothing: 'Issues one to each customer who asks.',
  bvn: 'Issues one to each customer who asks, once they give their BVN.',
  bvn_and_bank:
    'Issues one once the customer gives their BVN and a bank account in their name, which it checks first (usually within minutes).',
  unsupported: "Doesn't issue them, so customers top up with one-time account numbers only.",
} as const;

export interface ProviderView {
  key: string;
  name: string;
  about: string;
  fields: ProviderField[];
  /** Identity providers: the IDs it checks with a selfie match, and how it takes an agent's BVN. */
  idTypes: string[] | null;
  bvnAlongside: boolean | null;
  idChosenOnPage: boolean | null;
  /** Payments providers: whether it issues customers their own account number, and what the customer gives. */
  fixedAccounts: 'nothing' | 'bvn' | 'bvn_and_bank' | 'unsupported' | null;
  webhookUrl: string | null;
  webhookHint: string | null;
  /** Its callback address carries a secret token, which can be replaced. */
  hasCallbackToken: boolean;
  saved: boolean;
  complete: boolean;
  active: boolean;
  config: Record<string, string>;
  secretHints: Record<string, string>;
  updatedAt: string | null;
  updatedBy: string | null;
  lastTest: { at: string; ok: boolean; message: string; current: boolean } | null;
  /** Why the saved settings can't be used now (sandbox mode in production, say); null when they can. */
  problem: string | null;
}

function Hidden({ category, provider }: { category: string; provider: string }) {
  return (
    <>
      <input type="hidden" name="category" value={category} />
      <input type="hidden" name="provider" value={provider} />
    </>
  );
}

/**
 * One provider: its fields, Save, Test, and Switch on. Secret fields start empty and are never filled from
 * the server; what was saved shows only as its last characters, and leaving the field empty keeps it.
 */
export function ProviderCard({
  category,
  provider: p,
  canEdit,
  updated,
}: {
  category: string;
  provider: ProviderView;
  canEdit: boolean;
  updated: string | null;
}) {
  const [saveState, save] = useActionState<ProviderState, FormData>(saveProvider, {});
  const [testState, test] = useActionState<ProviderState, FormData>(testProvider, {});
  const [onState, switchOn] = useActionState<ProviderState, FormData>(activateProvider, {});
  const [removeState, remove] = useActionState<ProviderState, FormData>(removeProvider, {});
  const [renewState, renew] = useActionState<ProviderState, FormData>(renewCallback, {});
  const [config, setConfig] = useState(p.config);
  const [removing, setRemoving] = useState(false);
  const tested = p.lastTest?.current ? p.lastTest : null;
  const canSwitchOn = p.complete && !!tested?.ok && !p.active;

  return (
    <div className="rounded-xl border border-line p-4" id={`${category}-${p.key}`}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-[15px] font-bold">{p.name}</h3>
        {p.active ? <Badge tone="brand">On</Badge> : null}
        {!p.saved ? <Badge>Not set up</Badge> : !p.complete ? <Badge tone="warn">Missing fields</Badge> : null}
        {p.saved && p.complete ? (
          tested ? (
            <Badge tone={tested.ok ? 'brand' : 'danger'}>{tested.ok ? 'Test passed' : 'Test failed'}</Badge>
          ) : (
            <Badge tone="warn">Not tested since the last change</Badge>
          )
        ) : null}
      </div>
      <p className="mt-1 text-sm text-ink-3">{p.about}</p>
      {p.problem ? (
        <p className="mt-2 text-[13px] font-semibold text-danger" role="alert">
          These settings can&apos;t be used: {p.problem}
        </p>
      ) : null}
      {p.idTypes ? (
        <p className="mt-2 text-[13px] text-ink-2">
          <span className="font-semibold">Checks: </span>
          {p.idTypes.join(', ')}.{' '}
          {p.bvnAlongside
            ? "An agent's BVN can be checked alongside their ID."
            : "Can't check a BVN alongside another ID, so when agents must give their BVN, it is their ID."}
          {p.idChosenOnPage ? ' People pick their ID on its page, from those set up in its dashboard.' : ''}
        </p>
      ) : null}
      {p.fixedAccounts ? (
        <p className="mt-2 text-[13px] text-ink-2">
          <span className="font-semibold">Own account numbers: </span>
          {FIXED_ACCOUNTS[p.fixedAccounts]}
        </p>
      ) : null}
      {updated ? (
        <div className="mt-3">
          <Notice tone="brand">{updated}</Notice>
        </div>
      ) : null}

      <form action={save} className="mt-4 space-y-3">
        <Hidden category={category} provider={p.key} />
        <fieldset disabled={!canEdit} className="grid gap-3 sm:grid-cols-2">
          {p.fields.map((f) => {
            const hint = f.secret
              ? p.secretHints[f.key]
                ? `Saved: ${p.secretHints[f.key]}. Leave empty to keep it.`
                : f.hint
              : f.hint;
            const common = {
              name: f.key,
              placeholder: f.secret && p.secretHints[f.key] ? 'Saved — type a new one to replace it' : f.placeholder,
              autoComplete: 'off',
              spellCheck: false,
              'aria-describedby': hint ? `${category}-${p.key}-${f.key}-hint` : undefined,
            };
            return (
              <div key={f.key} className={f.multiline ? 'sm:col-span-2' : undefined}>
                <label className="block">
                  <span className="mb-1.5 block text-sm font-semibold">
                    {f.label}
                    {f.required ? null : <span className="font-normal text-ink-3"> (optional)</span>}
                  </span>
                  {f.multiline ? (
                    <textarea {...common} rows={4} className={`${inputClass} num h-auto py-2.5 text-[13px]`} />
                  ) : f.secret ? (
                    <input {...common} type="password" className={`${inputClass} num`} />
                  ) : (
                    <input
                      {...common}
                      value={config[f.key] ?? ''}
                      onChange={(e) => setConfig((c) => ({ ...c, [f.key]: e.currentTarget.value }))}
                      className={inputClass}
                    />
                  )}
                </label>
                {hint ? (
                  <p id={`${category}-${p.key}-${f.key}-hint`} className="mt-1.5 text-[13px] text-ink-3">
                    {hint}
                  </p>
                ) : null}
              </div>
            );
          })}
        </fieldset>
        {p.webhookUrl ? (
          <p className="text-[13px] text-ink-3">
            Address to give {p.name}: <span className="num font-semibold break-all text-ink-2">{p.webhookUrl}</span>
            {p.webhookHint ? <span className="block">{p.webhookHint}</span> : null}
          </p>
        ) : p.hasCallbackToken && !p.saved ? (
          <p className="text-[13px] text-ink-3">Save to get the callback address to give {p.name}.</p>
        ) : null}
        <Notice>{saveState.error}</Notice>
        {canEdit ? (
          <SubmitButton small kind="secondary" pendingLabel="Saving…">
            Save
          </SubmitButton>
        ) : null}
      </form>

      {canEdit && p.saved ? (
        <div className="mt-4 flex flex-wrap items-start gap-2 border-t border-line pt-4">
          <form action={test}>
            <Hidden category={category} provider={p.key} />
            <SubmitButton small kind="secondary" pendingLabel="Testing…">
              Test
            </SubmitButton>
          </form>
          {!p.active ? (
            <form action={switchOn}>
              <Hidden category={category} provider={p.key} />
              <button type="submit" className={buttonClass('primary', true)} disabled={!canSwitchOn}>
                Switch on
              </button>
            </form>
          ) : null}
          {p.hasCallbackToken ? (
            <form action={renew}>
              <Hidden category={category} provider={p.key} />
              <SubmitButton small kind="secondary" pendingLabel="Renewing…">
                New callback address
              </SubmitButton>
            </form>
          ) : null}
          {!p.active ? (
            removing ? (
              <form action={remove} className="flex gap-2">
                <Hidden category={category} provider={p.key} />
                <SubmitButton small kind="danger" pendingLabel="Removing…">
                  Yes, remove the keys
                </SubmitButton>
                <button type="button" className={buttonClass('ghost', true)} onClick={() => setRemoving(false)}>
                  Keep
                </button>
              </form>
            ) : (
              <button type="button" className={buttonClass('ghost', true)} onClick={() => setRemoving(true)}>
                Remove
              </button>
            )
          ) : null}
        </div>
      ) : null}
      <div className="mt-2 space-y-2" aria-live="polite">
        {testState.test ? (
          <Notice tone={testState.test.ok ? 'brand' : 'danger'}>{testState.test.message}</Notice>
        ) : tested && !tested.ok ? (
          <Notice>{tested.message}</Notice>
        ) : null}
        {!p.active && p.saved && p.complete && !tested?.ok ? (
          <p className="text-[13px] text-ink-3">Switch on becomes available once a test passes.</p>
        ) : null}
        <Notice>{testState.error ?? onState.error ?? removeState.error ?? renewState.error}</Notice>
      </div>
    </div>
  );
}

/** Switches the category back to what the server's own environment sets. */
export function SwitchOff({ category, fallback }: { category: string; fallback: string }) {
  const [state, action] = useActionState<ProviderState, FormData>(activateProvider, {});
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <Hidden category={category} provider="" />
      <SubmitButton small kind="secondary" pendingLabel="Switching…">
        Switch off
      </SubmitButton>
      <span className="text-[13px] text-ink-3">Then the server&apos;s own setting is used: {fallback}.</span>
      <Notice>{state.error}</Notice>
    </form>
  );
}
