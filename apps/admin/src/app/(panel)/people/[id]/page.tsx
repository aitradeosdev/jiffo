import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ErrandState } from '@jiffo/shared';
import { Badge, Card, Notice, Stat } from '@/components/ui';
import { api, ApiError, getCountry, getMe } from '@/lib/api';
import { ACCOUNT, JOURNAL, nameOf, STATUS, TIER } from '@/lib/errands';
import { ago, dateTime, money } from '@/lib/format';
import { AccessForm, TierForm, type TierTerms } from './forms';

export const metadata: Metadata = { title: 'Person' };

interface Stats {
  total: number;
  completed: number;
  cancelled: number;
  disputed: number;
}

interface Detail {
  person: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    phone: string;
    email: string | null;
    status: 'active' | 'suspended';
    countryCode: string;
    createdAt: string;
  };
  apps: string[];
  devices: Array<{
    app: string;
    platform: string;
    name: string | null;
    push: boolean;
    lastSeenAt: string;
    activeSessions: number;
  }>;
  agent: {
    tier: string;
    tiers: TierTerms[];
    tierSetAt: string | null;
    tierSetBy: string | null;
    categoryKeys: string[] | null;
    takesPurchases: boolean;
    online: boolean;
    lastLocatedAt: string | null;
    availableKobo: number;
    heldKobo: number;
    rating: number | null;
    stats: Stats;
    payoutAccount: { bankName: string; accountName: string; last4: string; since: string } | null;
  } | null;
  customer: { walletKobo: number; rating: number | null; stats: Stats };
  ratings: Array<{ raterRole: string; stars: number; comment: string | null; errandId: string; createdAt: string }>;
  errands: Array<{
    id: string;
    status: ErrandState;
    description: string;
    feeKobo: number;
    createdAt: string;
    asAgent: boolean;
  }>;
  money: Array<{
    id: number;
    account: string;
    kind: string;
    errandId: string | null;
    amountKobo: number;
    createdAt: string;
  }>;
  liveErrands: string[];
}

const DONE: Record<string, string> = {
  tier: 'Tier changed. The agent has been told.',
  suspend: 'Account suspended. They have been signed out everywhere.',
  reactivate: 'Account reactivated.',
};
const HISTORY: Record<string, string> = {
  ...JOURNAL,
  deposit: 'Top-up',
  payout: 'Withdrawal',
  payout_reversed: 'Withdrawal returned',
  hold_release: 'Earnings now available',
  settle: 'Errand paid out',
};

export default async function PersonPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ done?: string }>;
}) {
  const { id } = await params;
  const done = DONE[(await searchParams).done ?? ''];
  const [me, chosen] = await Promise.all([getMe(), getCountry()]);
  let d: Detail;
  try {
    d = await api<Detail>(`/admin/people/${encodeURIComponent(id)}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
  const country = me.countries.find((c) => c.code === d.person.countryCode) ?? chosen;
  const naira = (kobo: number) => money(kobo, country.currency);
  const time = (iso: string) => dateTime(iso, country.timezone);
  const canOperate = me.permissions.includes('operate');
  const p = d.person;
  const stats = (s: Stats) => (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <Stat label="Errands" value={s.total} />
      <Stat label="Completed" value={s.completed} />
      <Stat label="Cancelled" value={s.cancelled} />
      <Stat label="Disputed" value={s.disputed} tone={s.disputed ? 'warn' : undefined} />
    </div>
  );

  return (
    <>
      <Link
        href={d.agent ? '/people?role=agent' : '/people'}
        className="text-sm font-semibold text-ink-3 hover:text-ink"
      >
        ← People
      </Link>
      {done ? (
        <div className="mt-3">
          <Notice tone="brand">{done}</Notice>
        </div>
      ) : null}
      <div className="mt-3 mb-6">
        <div className="flex flex-wrap items-center gap-2">
          {d.apps.map((a) => (
            <Badge key={a}>{a === 'agent' ? 'Agent' : 'Customer'}</Badge>
          ))}
          {d.agent ? <Badge tone="brand">{TIER[d.agent.tier] ?? d.agent.tier}</Badge> : null}
          {p.status === 'suspended' ? <Badge tone="danger">Suspended</Badge> : null}
          {d.agent?.online ? <Badge tone="brand">Online now</Badge> : null}
        </div>
        <h1 className="mt-2 text-[28px] leading-tight font-extrabold tracking-tight">{nameOf(p)}</h1>
        <p className="num mt-1 text-[15px] text-ink-2">
          <a href={`tel:${p.phone}`} className="underline">
            {p.phone}
          </a>
          {p.email ? <span> · {p.email}</span> : null}
          <span className="text-ink-3"> · joined {time(p.createdAt)}</span>
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-6">
          {d.agent ? (
            <Card title="As an agent">
              {stats(d.agent.stats)}
              <div className="my-4 border-t border-line" />
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Stat label="Available" value={naira(d.agent.availableKobo)} />
                <Stat label="Held" value={naira(d.agent.heldKobo)} />
                <Stat label="Rating" value={d.agent.rating ? `${d.agent.rating} ★` : '—'} />
                <Stat
                  label="Last seen online"
                  value={d.agent.lastLocatedAt ? ago(d.agent.lastLocatedAt, country.timezone) : '—'}
                />
              </div>
            </Card>
          ) : null}
          {d.apps.includes('customer') ? (
            <Card title="As a customer">
              {stats(d.customer.stats)}
              <div className="my-4 border-t border-line" />
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Stat label="Wallet" value={naira(d.customer.walletKobo)} />
                <Stat label="Rating from agents" value={d.customer.rating ? `${d.customer.rating} ★` : '—'} />
              </div>
            </Card>
          ) : null}

          <Card title="Recent errands" padded={false}>
            {d.errands.length === 0 ? (
              <p className="px-5 py-4 text-sm text-ink-3">No errands yet.</p>
            ) : (
              <ul className="divide-y divide-line">
                {d.errands.map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <Link href={`/errands/${e.id}`} className="line-clamp-1 font-semibold hover:underline">
                        {e.description}
                      </Link>
                      <p className="text-[13px] text-ink-3">
                        {e.asAgent ? 'As agent' : 'As customer'} · {time(e.createdAt)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <Badge tone={STATUS[e.status]?.tone}>{STATUS[e.status]?.label ?? e.status}</Badge>
                      <span className="num font-semibold">{naira(e.feeKobo)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Recent money" padded={false}>
            {d.money.length === 0 ? (
              <p className="px-5 py-4 text-sm text-ink-3">No money has moved.</p>
            ) : (
              <ul className="divide-y divide-line">
                {d.money.map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                    <div>
                      <p className="font-semibold">{HISTORY[m.kind] ?? m.kind}</p>
                      <p className="text-[13px] text-ink-3">
                        {ACCOUNT[m.account] ?? m.account} · {time(m.createdAt)}
                        {m.errandId ? (
                          <>
                            {' · '}
                            <Link href={`/errands/${m.errandId}`} className="underline">
                              errand
                            </Link>
                          </>
                        ) : null}
                      </p>
                    </div>
                    <span className={`num font-semibold ${m.amountKobo >= 0 ? 'text-brand-ink' : ''}`}>
                      {m.amountKobo >= 0 ? '+' : '−'}
                      {naira(Math.abs(m.amountKobo))}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {d.ratings.length ? (
            <Card title="Ratings received">
              <ul className="space-y-2 text-sm">
                {d.ratings.map((r) => (
                  <li key={`${r.errandId}-${r.raterRole}`}>
                    <span className="font-semibold">{r.stars} ★</span> from the {r.raterRole}
                    {r.comment ? <span className="text-ink-2"> · “{r.comment}”</span> : null}
                    <span className="text-ink-3"> · {time(r.createdAt)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>

        <div className="space-y-6">
          {d.agent ? (
            <Card title="Tier">
              <p className="mb-3 text-[13px] text-ink-3">
                {d.agent.tierSetAt
                  ? `Set ${time(d.agent.tierSetAt)}${d.agent.tierSetBy ? ` by ${d.agent.tierSetBy}` : ''}`
                  : 'Bronze since joining'}
              </p>
              {canOperate ? (
                <TierForm key={d.agent.tier} id={p.id} tier={d.agent.tier} tiers={d.agent.tiers} />
              ) : (
                <p className="font-bold">{TIER[d.agent.tier] ?? d.agent.tier}</p>
              )}
            </Card>
          ) : null}

          {d.agent ? (
            <Card title="Agent settings">
              <dl className="space-y-2 text-sm">
                <div>
                  <dt className="text-ink-3">Categories</dt>
                  <dd>{d.agent.categoryKeys ? d.agent.categoryKeys.join(', ') : 'All'}</dd>
                </div>
                <div>
                  <dt className="text-ink-3">Buys items</dt>
                  <dd>{d.agent.takesPurchases ? 'Yes' : 'No'}</dd>
                </div>
                <div>
                  <dt className="text-ink-3">Payout account</dt>
                  <dd>
                    {d.agent.payoutAccount
                      ? `${d.agent.payoutAccount.accountName}, ${d.agent.payoutAccount.bankName} ····${d.agent.payoutAccount.last4}`
                      : 'None yet'}
                  </dd>
                </div>
              </dl>
            </Card>
          ) : null}

          <Card title="Devices">
            {d.devices.length === 0 ? (
              <p className="text-sm text-ink-3">None.</p>
            ) : (
              <ul className="space-y-2.5 text-sm">
                {d.devices.map((dev, i) => (
                  <li key={i}>
                    <p className="font-semibold">
                      {dev.name || dev.platform} · {dev.app === 'agent' ? 'Agent app' : 'Customer app'}
                    </p>
                    <p className="text-[13px] text-ink-3">
                      {dev.platform} · seen {ago(dev.lastSeenAt, country.timezone)} ·{' '}
                      {dev.activeSessions ? 'signed in' : 'signed out'}
                      {dev.push ? ' · notifications on' : ''}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {canOperate ? (
            <Card title="Access">
              {d.liveErrands.length && p.status === 'active' ? (
                <p className="mb-3 text-[13px] text-ink-3">
                  {d.liveErrands.length} errand{d.liveErrands.length === 1 ? '' : 's'} not finished yet.
                </p>
              ) : null}
              <AccessForm key={p.status} id={p.id} suspended={p.status === 'suspended'} />
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
