import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import type { ErrandState } from '@jiffo/shared';
import { Badge, Card, Notice } from '@/components/ui';
import { api, ApiError, getCountry, getMe } from '@/lib/api';
import { ACCOUNT, EVENT, getCategories, JOURNAL, nameOf, STATUS, type PersonRef } from '@/lib/errands';
import { dateTime, money } from '@/lib/format';
import { ActionsForm } from './actions-form';

export const metadata: Metadata = { title: 'Errand' };

interface Detail {
  errand: {
    id: string;
    countryCode: string;
    status: ErrandState;
    version: number;
    description: string;
    categoryKey: string;
    buy: boolean;
    urgent: boolean;
    feeKobo: number;
    serviceFeeKobo: number;
    itemAmountKobo: number | null;
    scheduledFor: string | null;
    agentTier: string | null;
    pinAttempts: number;
    createdAt: string;
  };
  customer: (PersonRef & { status: string }) | null;
  agent: (PersonRef & { status: string; tier: string }) | null;
  stops: Array<{ seq: number; kind: string; label: string | null; address: string }>;
  events: Array<{
    id: number;
    event: string;
    toStatus: ErrandState;
    actorRole: string;
    actorName: string | null;
    data: Record<string, unknown>;
    createdAt: string;
  }>;
  chat: Array<{
    id: number;
    senderRole: string;
    kind: string;
    body: string;
    photoUrl: string | null;
    createdAt: string;
  }>;
  photos: Array<{ purpose: string; from: string | null; url: string; createdAt: string }>;
  money: {
    heldFeeKobo: number;
    heldItemsKobo: number;
    customerBalanceKobo: number;
    standard: { agentKobo: number; jiffoKobo: number };
    chargeableKobo: number;
    journal: Array<{
      id: string;
      kind: string;
      data: Record<string, unknown>;
      createdAt: string;
      postings: Array<{ account: string; owner: string | null; amountKobo: number }>;
    }>;
  };
  ratings: Array<{ raterRole: string; stars: number; comment: string | null }>;
  actions: string[];
}

const PHOTO: Record<string, string> = {
  receipt: 'Receipt',
  item_photo: 'Items',
  dropoff_photo: 'Drop-off',
  chat_photo: 'In chat',
};
const WHO: Record<string, string> = { customer: 'Customer', agent: 'Agent', system: 'Jiffo', admin: 'Support' };

const DONE: Record<string, string> = {
  admin_intervene: 'You stepped in. The errand is in dispute and its money stays held.',
  redeliver: 'Redelivery arranged. Both sides have been told.',
  resolve_complete: 'Settled as complete. Both sides have been told.',
  resolve_cancel: 'Settled as cancelled. Both sides have been told.',
};

const STOP: Record<string, string> = { pickup: 'Pickup', stop: 'Extra stop', dropoff: 'Drop-off' };

export default async function ErrandPage({
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
    d = await api<Detail>(`/admin/errands/${encodeURIComponent(id)}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
  // The errand's own country, whichever one the admin is looking at: its currency, clock and categories.
  const country = me.countries.find((c) => c.code === d.errand.countryCode) ?? chosen;
  const categories = await getCategories(country.code);
  const naira = (kobo: number) => money(kobo, country.currency);
  const time = (iso: string) => dateTime(iso, country.timezone);
  const e = d.errand;
  const status = STATUS[e.status];
  const canAct = me.permissions.includes('operate') && d.actions.length > 0;

  /** The useful facts an event carried, in words. */
  const factsOf = (ev: Detail['events'][number]): ReactNode[] => {
    const out: ReactNode[] = [];
    const x = ev.data;
    if (typeof x.amountKobo === 'number') out.push(naira(x.amountKobo));
    if (typeof x.previousFeeKobo === 'number') out.push(`was ${naira(x.previousFeeKobo)}`);
    if (typeof x.reason === 'string') out.push(`“${x.reason}”`);
    if (typeof x.note === 'string') out.push(`“${x.note}”`);
    if (x.split && typeof x.split === 'object') {
      const s = x.split as Record<string, number>;
      out.push(
        `Split: agent ${naira(s.agentKobo ?? 0)}, Jiffo ${naira(s.jiffoKobo ?? 0)}, items to agent ${naira(
          s.itemsToAgentKobo ?? 0,
        )}, charged ${naira(s.chargeCustomerKobo ?? 0)}`,
      );
    }
    if (x.timer) out.push('by timer');
    return out;
  };

  return (
    <>
      <Link href="/errands" className="text-sm font-semibold text-ink-3 hover:text-ink">
        ← Errands
      </Link>
      {done ? (
        <div className="mt-3">
          <Notice tone="brand">{done}</Notice>
        </div>
      ) : null}
      <div className="mt-3 mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={status?.tone}>{status?.label ?? e.status}</Badge>
            <span className="text-[13px] text-ink-3">
              {categories.get(e.categoryKey) ?? e.categoryKey}
              {e.buy ? ' · buys items' : ''}
              {e.urgent ? ' · urgent' : ''} · requested {time(e.createdAt)}
            </span>
          </div>
          <h1 className="mt-2 max-w-3xl text-2xl leading-snug font-extrabold tracking-tight">{e.description}</h1>
          <p className="num mt-1 text-[13px] text-ink-3 select-all">{e.id}</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-6">
          <Card title="Timeline">
            <ol className="relative space-y-4 border-l-2 border-line pl-5">
              {d.events.map((ev) => (
                <li key={ev.id} className="relative">
                  <span
                    className={`absolute top-1.5 -left-[27px] size-3 rounded-full border-2 border-surface ${
                      ev.actorRole === 'admin' ? 'bg-ink' : ev.toStatus === 'disputed' ? 'bg-danger' : 'bg-chart'
                    }`}
                    aria-hidden="true"
                  />
                  <p className="font-semibold">{EVENT[ev.event] ?? ev.event}</p>
                  <p className="text-[13px] text-ink-3">
                    {time(ev.createdAt)} · {WHO[ev.actorRole] ?? ev.actorRole}
                    {ev.actorName ? ` (${ev.actorName})` : ''}
                  </p>
                  {factsOf(ev).length ? <p className="mt-0.5 text-sm text-ink-2">{factsOf(ev).join(' · ')}</p> : null}
                </li>
              ))}
            </ol>
          </Card>

          <Card title={`Chat (${d.chat.length})`}>
            {d.chat.length === 0 ? (
              <p className="text-sm text-ink-3">No messages.</p>
            ) : (
              <ol className="max-h-[520px] space-y-2 overflow-y-auto pr-1">
                {d.chat.map((m) =>
                  m.senderRole === 'system' ? (
                    <li key={m.id} className="text-center text-[13px] text-ink-3">
                      {m.body} · {time(m.createdAt)}
                    </li>
                  ) : (
                    <li key={m.id} className={`flex ${m.senderRole === 'agent' ? 'justify-start' : 'justify-end'}`}>
                      <div
                        className={`max-w-[80%] rounded-2xl px-3.5 py-2 ${
                          m.senderRole === 'agent' ? 'bg-surface-2' : 'bg-ink text-on-ink'
                        }`}
                      >
                        <p className="text-[11px] font-bold tracking-wide uppercase opacity-70">{WHO[m.senderRole]}</p>
                        {m.photoUrl ? (
                          <a href={m.photoUrl} target="_blank" rel="noreferrer">
                            <img src={m.photoUrl} alt="Photo sent in chat" className="mt-1 max-h-48 rounded-lg" />
                          </a>
                        ) : (
                          <p className="text-[15px] whitespace-pre-wrap">{m.body}</p>
                        )}
                        <p className="mt-0.5 text-[11px] opacity-60">{time(m.createdAt)}</p>
                      </div>
                    </li>
                  ),
                )}
              </ol>
            )}
          </Card>

          <Card title={`Photos (${d.photos.length})`}>
            {d.photos.length === 0 ? (
              <p className="text-sm text-ink-3">No photos.</p>
            ) : (
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {d.photos.map((p, i) => (
                  <li key={i}>
                    <a
                      href={p.url}
                      target="_blank"
                      rel="noreferrer"
                      className="block overflow-hidden rounded-xl bg-surface-2"
                    >
                      <img
                        src={p.url}
                        alt={`${PHOTO[p.purpose] ?? p.purpose} photo`}
                        className="aspect-square w-full object-cover"
                      />
                    </a>
                    <p className="mt-1 text-[13px] text-ink-3">
                      {PHOTO[p.purpose] ?? p.purpose} · {WHO[p.from ?? ''] ?? '—'} · {time(p.createdAt)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          {canAct ? (
            <Card title="Support actions">
              {/* A new version (after any change) starts the form afresh with the actions allowed now. */}
              <ActionsForm
                key={e.version}
                id={e.id}
                version={e.version}
                actions={d.actions}
                facts={{
                  currency: country.currency,
                  heldFeeKobo: d.money.heldFeeKobo,
                  heldItemsKobo: d.money.heldItemsKobo,
                  agentKobo: d.money.standard.agentKobo,
                  jiffoKobo: d.money.standard.jiffoKobo,
                  chargeableKobo: d.money.chargeableKobo,
                  customerBalanceKobo: d.money.customerBalanceKobo,
                }}
              />
            </Card>
          ) : null}

          <Card title="People">
            <dl className="space-y-4">
              {[
                { role: 'Customer', p: d.customer, extra: null },
                {
                  role: 'Agent',
                  p: d.agent,
                  extra: d.agent ? `${d.agent.tier[0]!.toUpperCase()}${d.agent.tier.slice(1)} tier` : null,
                },
              ].map(({ role, p, extra }) => (
                <div key={role}>
                  <dt className="text-[13px] font-semibold text-ink-3">{role}</dt>
                  {p ? (
                    <dd>
                      <p className="font-bold">
                        <Link href={`/people/${p.id}`} className="hover:underline">
                          {nameOf(p)}
                        </Link>
                        {p.status === 'suspended' ? (
                          <span className="ml-2">
                            <Badge tone="danger">Suspended</Badge>
                          </span>
                        ) : null}
                      </p>
                      <p className="num text-sm">
                        <a href={`tel:${p.phone}`} className="underline">
                          {p.phone}
                        </a>
                        {extra ? <span className="text-ink-3"> · {extra}</span> : null}
                      </p>
                    </dd>
                  ) : (
                    <dd className="text-ink-3">None yet</dd>
                  )}
                </div>
              ))}
            </dl>
          </Card>

          <Card title="Route">
            <ol className="space-y-3">
              {d.stops.map((s) => (
                <li key={s.seq}>
                  <p className="text-[13px] font-semibold text-ink-3">{STOP[s.kind] ?? s.kind}</p>
                  <p className="text-sm">
                    {s.label ? <span className="font-semibold">{s.label} · </span> : null}
                    {s.address}
                  </p>
                </li>
              ))}
            </ol>
          </Card>

          <Card title="Money">
            <dl className="num grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <dt className="text-ink-3">Agent fee</dt>
              <dd className="text-right font-semibold">{naira(e.feeKobo)}</dd>
              <dt className="text-ink-3">Service fee</dt>
              <dd className="text-right font-semibold">{naira(e.serviceFeeKobo)}</dd>
              {e.itemAmountKobo ? (
                <>
                  <dt className="text-ink-3">Item amount</dt>
                  <dd className="text-right font-semibold">{naira(e.itemAmountKobo)}</dd>
                </>
              ) : null}
              <dt className="text-ink-3">Held now</dt>
              <dd className="text-right font-bold">{naira(d.money.heldFeeKobo + d.money.heldItemsKobo)}</dd>
            </dl>
            <h3 className="mt-5 mb-2 text-[13px] font-semibold text-ink-3">Every movement</h3>
            {d.money.journal.length === 0 ? (
              <p className="text-sm text-ink-3">No money has moved.</p>
            ) : (
              <ol className="space-y-3">
                {d.money.journal.map((j) => (
                  <li key={j.id} className="rounded-xl bg-surface-2 p-3">
                    <p className="flex justify-between gap-2 text-sm font-bold">
                      {j.kind === 'settle' && j.data.resolution ? 'Settled by support' : (JOURNAL[j.kind] ?? j.kind)}
                      <span className="font-normal text-ink-3">{time(j.createdAt)}</span>
                    </p>
                    <ul className="num mt-1.5 space-y-0.5 text-[13px]">
                      {j.postings.map((p, i) => (
                        <li key={i} className="flex justify-between gap-2">
                          <span className="text-ink-2">{ACCOUNT[p.account] ?? p.account}</span>
                          <span className={p.amountKobo >= 0 ? 'text-brand-ink' : 'text-ink-2'}>
                            {p.amountKobo >= 0 ? '+' : '−'}
                            {naira(Math.abs(p.amountKobo))}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ol>
            )}
          </Card>

          {d.ratings.length ? (
            <Card title="Ratings">
              <ul className="space-y-2 text-sm">
                {d.ratings.map((r) => (
                  <li key={r.raterRole}>
                    <span className="font-semibold">{WHO[r.raterRole]}</span> gave {r.stars}/5
                    {r.comment ? <span className="text-ink-2"> · “{r.comment}”</span> : null}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
