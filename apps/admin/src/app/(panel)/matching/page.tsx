import type { Metadata } from 'next';
import Link from 'next/link';
import { Card, Empty, PageHeader, inputClass, buttonClass, tableClass, tdClass, thClass } from '@/components/ui';
import { api, getCountry } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { duration, share } from '@/lib/matching';

export const metadata: Metadata = { title: 'Matching' };

interface Figures {
  errands: number;
  urgent: number;
  firstOfferSeconds: number | null;
  acceptSeconds: number | null;
  offersPerErrand: number | null;
  everyoneShare: number | null;
  expiredShare: number | null;
  pickups: number;
  predictedPickupSeconds: number | null;
  actualPickupSeconds: number | null;
}
interface Dashboard {
  days: number;
  places: Array<Figures & { stateCode: string; stateName: string; categoryKey: string; categoryName: string }>;
  total: Figures | null;
  agents: Array<{
    id: string;
    firstName: string | null;
    lastName: string | null;
    offers: number;
    accepted: number;
    declined: number;
    expired: number;
    acceptanceRate: number | null;
    countedOffers: number;
    completionRate: number | null;
    cancellations7d: number;
  }>;
  /** Acceptance prediction (M13): each state's newest model. */
  predictions: Array<{ stateCode: string; offers: number; logLoss: number; trainedAt: string; inUse: boolean }>;
}

const PERIODS = [
  { days: 1, label: 'Last day' },
  { days: 7, label: 'Last 7 days' },
  { days: 30, label: 'Last 30 days' },
] as const;

const COLUMNS = [
  'Errands',
  'Urgent',
  'To first offer',
  'To accept',
  'Offers each',
  'Open to everyone',
  'Expired',
  'Pickup: expected / took',
];

function cells(f: Figures) {
  return [
    String(f.errands),
    String(f.urgent),
    duration(f.firstOfferSeconds),
    duration(f.acceptSeconds),
    f.offersPerErrand === null ? '—' : f.offersPerErrand.toFixed(1),
    share(f.everyoneShare),
    share(f.expiredShare),
    f.pickups ? `${duration(f.predictedPickupSeconds)} / ${duration(f.actualPickupSeconds)} (${f.pickups})` : '—',
  ];
}

/**
 * The matching dashboard (docs/matching.md, M15): for errands sent over the last day, week or month, per state and
 * category, how quickly they were offered and taken, how far their search went, and the pickup time expected
 * against the real one; then the agents with the most offers, and what they did with them.
 */
export default async function MatchingPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string; state?: string }>;
}) {
  const p = await searchParams;
  const days = PERIODS.find((x) => String(x.days) === p.days)?.days ?? 7;
  const state = p.state && /^[A-Za-z]{2,8}$/.test(p.state) ? p.state.toUpperCase() : '';
  const country = await getCountry();
  const [d, states] = await Promise.all([
    api<Dashboard>(`/admin/matching?country=${country.code}&days=${days}${state ? `&state=${state}` : ''}`),
    api<Array<{ code: string; name: string }>>(`/admin/states?country=${country.code}`),
  ]);
  const href = (next: { days?: number; state?: string }) => {
    const q = new URLSearchParams();
    const nd = next.days ?? days;
    const ns = next.state ?? state;
    if (nd !== 7) q.set('days', String(nd));
    if (ns) q.set('state', ns);
    return `/matching${q.size ? `?${q}` : ''}`;
  };
  const pill = (current: boolean) =>
    `h-9 rounded-full px-3.5 text-sm leading-9 font-semibold ${
      current ? 'bg-ink text-on-ink' : 'bg-surface text-ink-2 hover:bg-surface-2'
    }`;

  return (
    <>
      <PageHeader
        title="Matching"
        subtitle="How errands are offered and taken, per state and category, and how agents answer their offers. Times are medians. An errand counts in the period it was sent."
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <nav aria-label="Period" className="flex flex-wrap gap-1.5">
          {PERIODS.map((x) => (
            <Link
              key={x.days}
              href={href({ days: x.days })}
              aria-current={x.days === days ? 'page' : undefined}
              className={pill(x.days === days)}
            >
              {x.label}
            </Link>
          ))}
        </nav>
        <form action="/matching" className="flex items-center gap-2">
          {days !== 7 ? <input type="hidden" name="days" value={days} /> : null}
          <label className="sr-only" htmlFor="matching-state">
            State
          </label>
          <select id="matching-state" name="state" defaultValue={state} className={`${inputClass} w-auto`}>
            <option value="">Every state</option>
            {states.map((s) => (
              <option key={s.code} value={s.code}>
                {s.name}
              </option>
            ))}
          </select>
          <button type="submit" className={buttonClass('secondary', true)}>
            Show
          </button>
        </form>
      </div>

      <div className="space-y-6">
        <Card title="Per state and category" padded={false}>
          {d.places.length === 0 || !d.total ? (
            <Empty title="No errands sent in this period" />
          ) : (
            <div className="overflow-x-auto">
              <table className={tableClass}>
                <thead>
                  <tr className="border-b border-line">
                    <th className={thClass}>Where, what</th>
                    {COLUMNS.map((c) => (
                      <th key={c} className={thClass}>
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {d.places.map((row) => (
                    <tr key={`${row.stateCode}-${row.categoryKey}`} className="border-b border-line last:border-0">
                      <td className={tdClass}>
                        <span className="font-semibold">{row.stateName}</span>
                        <span className="block text-[13px] text-ink-3">{row.categoryName}</span>
                      </td>
                      {cells(row).map((c, i) => (
                        <td key={COLUMNS[i]} className={`${tdClass} whitespace-nowrap`}>
                          {c}
                        </td>
                      ))}
                    </tr>
                  ))}
                  <tr className="bg-surface-2 font-semibold">
                    <td className={tdClass}>{state ? 'All of the state' : 'All'}</td>
                    {cells(d.total).map((c, i) => (
                      <td key={COLUMNS[i]} className={`${tdClass} whitespace-nowrap`}>
                        {c}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <p className="-mt-3 text-[13px] text-ink-3">
          Offer figures are for urgent errands; a board errand counts toward the errands and the time to accept. The
          pickup times are for errands taken from an offer whose agent then reached the pickup: the travel time the
          offer was ranked with, against how long they took from accepting.
        </p>

        <Card title="Acceptance prediction">
          {d.predictions.length === 0 ? (
            <p className="text-sm text-ink-3">
              No state has enough answered offers yet. Each is learnt from nightly once it has the number in Settings,
              Matching; until then, ranking is as without it.
            </p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {d.predictions.map((p) => (
                <li key={p.stateCode}>
                  <span className="font-semibold">
                    {states.find((s) => s.code === p.stateCode)?.name ?? p.stateCode}
                  </span>{' '}
                  · learnt from {p.offers.toLocaleString('en-NG')} offers on {dateTime(p.trainedAt, country.timezone)}
                  {p.inUse ? '' : ' · not refitted for a week, so not in use'}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Agents with the most offers" padded={false}>
          {d.agents.length === 0 ? (
            <Empty title="No offers in this period" />
          ) : (
            <div className="overflow-x-auto">
              <table className={tableClass}>
                <thead>
                  <tr className="border-b border-line">
                    {[
                      'Agent',
                      'Offers',
                      'Accepted',
                      'Declined',
                      'Ran out',
                      'Acceptance',
                      'Completion',
                      'Left this week',
                    ].map((c) => (
                      <th key={c} className={thClass}>
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {d.agents.map((a) => (
                    <tr key={a.id} className="border-b border-line last:border-0">
                      <td className={tdClass}>
                        <Link href={`/people/${a.id}`} className="font-semibold underline">
                          {[a.firstName, a.lastName].filter(Boolean).join(' ') || 'No name yet'}
                        </Link>
                      </td>
                      <td className={tdClass}>{a.offers}</td>
                      <td className={tdClass}>{a.accepted}</td>
                      <td className={tdClass}>{a.declined}</td>
                      <td className={tdClass}>{a.expired}</td>
                      <td className={tdClass}>
                        {share(a.acceptanceRate)}
                        {a.acceptanceRate === null ? null : (
                          <span className="block text-[13px] text-ink-3">last {a.countedOffers} counted</span>
                        )}
                      </td>
                      <td className={tdClass}>{share(a.completionRate)}</td>
                      <td className={tdClass}>{a.cancellations7d}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
