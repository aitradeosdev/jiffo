import type { Metadata } from 'next';
import Link from 'next/link';
import {
  RISK_FLAG_STATUSES,
  RISK_QUEUE_INFO,
  RISK_QUEUES,
  type RiskFlagKind,
  type RiskFlagStatus,
  type RiskQueue,
} from '@jiffo/shared';
import { Pager } from '@/components/list-controls';
import { Badge, Card, Empty, Notice, PageHeader } from '@/components/ui';
import { api, getCountry, getMe } from '@/lib/api';
import { nameOf, type PersonRef } from '@/lib/errands';
import { dateTime, money } from '@/lib/format';
import { listLink } from '@/lib/links';
import { FlagDecisionForm } from './decision';

export const metadata: Metadata = { title: 'Flags' };

interface Flag {
  id: string;
  queue: RiskQueue;
  kind: RiskFlagKind;
  label: string;
  about: string;
  status: RiskFlagStatus;
  details: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  decisionNote: string | null;
  people: PersonRef[];
  errands: Array<{ id: string; status: string; description: string; feeKobo: number; createdAt: string }>;
  errandCount: number;
}

const STATUS: Record<RiskFlagStatus, { label: string; tone: 'warn' | 'neutral' | 'danger' }> = {
  open: { label: 'Open', tone: 'warn' },
  confirmed: { label: 'Confirmed fraud', tone: 'danger' },
  cleared: { label: 'Cleared', tone: 'neutral' },
};

const QUEUE_ABOUT: Record<RiskQueue, string> = {
  risk: "Errands that look like fraud: cash runs, money sent to accounts, a customer and agent who share a phone, a network or a bank, the same pair again and again, high-value errands finished too fast, and agents' positions that look faked. A flag refuses nothing: you decide. Flagged errands are left out of the agent's counts for tiers until cleared.",
  verification:
    "Accounts that share a phone, where at least one is an agent's, bank accounts two agents saved, and a face the identity provider found on another account. Look at both accounts before deciding: family members do share phones.",
};

const DONE: Record<string, string> = {
  clear: 'Flag cleared. Its errands count again.',
  confirm: 'Confirmed as fraud. Suspend the accounts from their pages if they should stop.',
  reopen: 'Flag reopened.',
};

const SHARED_BY: Record<string, string> = {
  install: 'the same install of the app',
  key: "the same phone's key",
  phone: 'the same phone, in both apps',
};

/** What was found, in words, from the flag's details. */
function finding(f: Flag, naira: (kobo: number) => string) {
  const d = f.details;
  const list = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);
  switch (f.kind) {
    case 'cash_errand':
    case 'send_money':
      return `Asked: ${list(d.words).join(', ')}`;
    case 'same_place':
      return `Pickup and drop-off ${Number(d.metres)} m apart`;
    case 'shared_phone':
    case 'pair_shared_phone':
      return `Seen on ${list(d.by)
        .map((b) => SHARED_BY[b] ?? b)
        .join(', ')}`;
    case 'pair_shared_network':
      return list(d.by).includes('wifi')
        ? 'Both phones used the same Wi-Fi network in the last weeks'
        : 'Both phones used the same internet address in the last weeks';
    case 'same_face':
      return d.sameIdNumber
        ? 'The identity provider found this face, with the same ID number, on the other account'
        : "The identity provider found this face on the other account's check, with another ID";
    case 'gps_jump':
      return `Moved ${(Number(d.metres) / 1000).toFixed(1)} km in ${Number(d.seconds)} seconds: ${Number(d.kmh)} km/h`;
    case 'gps_straight':
      return `${Number(d.points)} positions in a straight line over ${Number(d.metres)} m, at an even ${Number(d.kmh)} km/h`;
    case 'no_movement':
      return `Stayed within ${Number(d.metres)} m for ${Number(d.minutes)} minutes; the stops are ${(Number(d.routeMetres) / 1000).toFixed(1)} km apart`;
    case 'repeat_pairing':
      return `${f.errandCount} errands together within ${Number(d.days)} days`;
    case 'fast_high_value':
      return `Worth ${naira(Number(d.valueKobo))}, delivered ${Number(d.minutes)} min after accepting; the route needs at least ${Number(d.leastMinutes)} min`;
    case 'shared_payout_account':
      return `${String(d.bankName ?? 'Bank')} account ending ${String(d.last4 ?? '????')}`;
    default:
      return f.about;
  }
}

/** The Risk queue and the verification team's flags: one queue at a time, open ones oldest first. */
export default async function FlagsPage({
  searchParams,
}: {
  searchParams: Promise<{
    queue?: string;
    status?: string;
    before?: string;
    done?: string;
    person?: string;
    errand?: string;
  }>;
}) {
  const p = await searchParams;
  const queue = RISK_QUEUES.find((q) => q === p.queue) ?? 'risk';
  const status = RISK_FLAG_STATUSES.find((s) => s === p.status) ?? 'open';
  const country = await getCountry();
  // Flags about one person or errand, from their pages.
  const uuid = (v: string | undefined) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : undefined);
  const person = uuid(p.person);
  const errand = uuid(p.errand);
  const query = new URLSearchParams({ country: country.code, queue, status });
  if (p.before) query.set('before', p.before);
  if (person) query.set('person', person);
  if (errand) query.set('errand', errand);
  const [page, counts, me] = await Promise.all([
    api<{ flags: Flag[]; next: string | null }>(`/admin/flags?${query}`),
    api<Record<RiskQueue, Record<RiskFlagStatus, number>>>(
      `/admin/flags/counts?${new URLSearchParams({
        country: country.code,
        ...(person ? { person } : {}),
        ...(errand ? { errand } : {}),
      })}`,
    ),
    getMe(),
  ]);
  const canDecide = me.permissions.includes(RISK_QUEUE_INFO[queue].permission);
  const naira = (kobo: number) => money(kobo, country.currency);
  const time = (iso: string) => dateTime(iso, country.timezone);
  const link = (changes: Record<string, string | null>) =>
    listLink('/flags', { queue, status, person, errand }, changes, { queue: 'risk', status: 'open' });
  const done = DONE[p.done ?? ''];
  const pill = (current: boolean) =>
    `h-9 rounded-full px-3.5 text-sm leading-9 font-semibold ${
      current ? 'bg-ink text-on-ink' : 'bg-surface text-ink-2 hover:bg-surface-2'
    }`;

  return (
    <>
      <PageHeader title={queue === 'risk' ? 'Risk queue' : 'Shared accounts'} subtitle={QUEUE_ABOUT[queue]} />
      {person || errand ? (
        <p className="mb-4 text-sm text-ink-2">
          Showing the flags about one {person ? 'person' : 'errand'}.{' '}
          <Link href={link({ person: null, errand: null, before: null })} className="font-semibold underline">
            Show all
          </Link>
        </p>
      ) : null}
      {done ? (
        <div className="mb-4">
          <Notice tone="brand">{done}</Notice>
        </div>
      ) : null}
      <nav aria-label="Queue" className="mb-3 flex flex-wrap gap-1.5">
        {RISK_QUEUES.map((q) => (
          <Link
            key={q}
            href={link({ queue: q, status: null, before: null })}
            aria-current={q === queue ? 'page' : undefined}
            className={pill(q === queue)}
          >
            {RISK_QUEUE_INFO[q].label} · {counts[q].open}
          </Link>
        ))}
      </nav>
      <nav aria-label="Flag status" className="mb-4 flex flex-wrap gap-1.5">
        {RISK_FLAG_STATUSES.map((s) => (
          <Link
            key={s}
            href={link({ status: s, before: null })}
            aria-current={s === status ? 'page' : undefined}
            className={pill(s === status)}
          >
            {STATUS[s].label} · {counts[queue][s]}
          </Link>
        ))}
      </nav>
      <Card padded={false}>
        {page.flags.length === 0 ? (
          <Empty title={status === 'open' ? 'Nothing to look at' : `No flags ${STATUS[status].label.toLowerCase()}`}>
            {person || errand
              ? 'Nothing here about them. The counts above show where their flags are.'
              : status === 'open'
                ? 'Flags that need a person show up here.'
                : null}
          </Empty>
        ) : (
          <ul className="divide-y divide-line">
            {page.flags.map((f) => (
              <li key={f.id} className="px-5 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold">{f.label}</span>
                  <Badge tone={STATUS[f.status].tone}>{STATUS[f.status].label}</Badge>
                  <span className="num text-[13px] text-ink-3">{time(f.createdAt)}</span>
                </div>
                <p className="mt-1 text-sm text-ink-2">{finding(f, naira)}</p>
                <p className="mt-1 text-sm">
                  {f.people.map((person, i) => (
                    <span key={person.id}>
                      {i ? ' and ' : ''}
                      <Link href={`/people/${person.id}`} className="font-semibold underline">
                        {nameOf(person)}
                      </Link>{' '}
                      <span className="num text-ink-3">{person.phone}</span>
                    </span>
                  ))}
                </p>
                {f.errands.length ? (
                  <ul className="mt-2 space-y-1 text-sm">
                    {f.errands.map((e) => (
                      <li key={e.id}>
                        <Link href={`/errands/${e.id}`} className="underline">
                          {e.description.length > 80 ? `${e.description.slice(0, 80)}…` : e.description}
                        </Link>{' '}
                        <span className="text-ink-3">
                          · {naira(e.feeKobo)} · {e.status}
                        </span>
                      </li>
                    ))}
                    {f.errandCount > f.errands.length ? (
                      <li className="text-ink-3">and {f.errandCount - f.errands.length} more</li>
                    ) : null}
                  </ul>
                ) : null}
                {f.decidedAt ? (
                  <p className="mt-2 text-sm text-ink-2">
                    <span className="font-semibold">{f.decidedBy ?? 'Someone'}:</span> {f.decisionNote}{' '}
                    <span className="text-ink-3">· {time(f.decidedAt)}</span>
                  </p>
                ) : null}
                {canDecide ? <FlagDecisionForm id={f.id} open={f.status === 'open'} /> : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Pager
        newest={p.before ? link({ before: null }) : null}
        older={page.next ? link({ before: page.next }) : null}
        labels={status === 'open' ? { first: 'Longest waiting', next: 'Next' } : undefined}
      />
    </>
  );
}
