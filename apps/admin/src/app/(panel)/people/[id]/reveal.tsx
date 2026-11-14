'use client';

import { useState, type ReactNode } from 'react';
import { yearsOld } from '@jiffo/shared';
import { SubmitButton } from '@/components/submit-button';
import { Card, inputClass, Notice } from '@/components/ui';
import { revealPerson, type Revealed } from './actions';

const row = (label: string, value: ReactNode) => (
  <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 py-1.5 text-sm">
    <dt className="text-ink-3">{label}</dt>
    <dd className="font-semibold">{value}</dd>
  </div>
);
const born = (date: string | null) => (date ? `${date} · ${yearsOld(date)} years old` : '—');

/**
 * Personal details are masked (docs/security-plan.md, D5). Revealing them takes a reason, goes in the audit
 * log, and counts towards a daily limit; they show here, on this page only, until it is left.
 */
export function RevealCard({ id }: { id: string }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string>();
  const [shown, setShown] = useState<Revealed>();
  return (
    <Card title="Personal details">
      {shown ? (
        <dl className="divide-y divide-line">
          {shown.identity ? row('Name on their ID', shown.identity.legalName ?? '—') : null}
          {shown.identity ? row('Date of birth (ID check)', born(shown.identity.dateOfBirth)) : null}
          {shown.application ? row('Name on their ID (application)', shown.application.legalName ?? '—') : null}
          {shown.application ? row('Date of birth', born(shown.application.dateOfBirth)) : null}
          {shown.application ? row('Home address', shown.application.address ?? '—') : null}
          {shown.application?.emergency
            ? row(
                'Emergency contact',
                <>
                  {shown.application.emergency.name}
                  {shown.application.emergency.relationship
                    ? ` (${shown.application.emergency.relationship.toLowerCase()})`
                    : ''}
                  {shown.application.emergency.phone ? (
                    <a href={`tel:${shown.application.emergency.phone}`} className="num ml-2 underline">
                      {shown.application.emergency.phone}
                    </a>
                  ) : null}
                </>,
              )
            : null}
        </dl>
      ) : (
        <form
          className="space-y-2"
          action={async () => {
            setError(undefined);
            const res = await revealPerson(id, reason);
            if ('error' in res) setError(res.error);
            else setShown(res);
          }}
        >
          <p className="text-sm text-ink-3">
            Their legal name, date of birth, address and emergency contact are hidden. Revealing them is recorded with
            your reason, and you can reveal only so many people a day.
          </p>
          <label className="block">
            <span className="sr-only">Why you need them</span>
            <input
              value={reason}
              onChange={(e) => setReason(e.currentTarget.value)}
              required
              minLength={5}
              maxLength={500}
              placeholder="Why you need them"
              className={inputClass}
            />
          </label>
          <SubmitButton kind="secondary" small pendingLabel="Revealing…">
            Reveal
          </SubmitButton>
          <Notice>{error}</Notice>
        </form>
      )}
    </Card>
  );
}
