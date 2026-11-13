import type { Metadata } from 'next';
import Link from 'next/link';
import { ColumnChart } from '@/components/column-chart';
import { Card, Stat } from '@/components/ui';
import { api, getCountry } from '@/lib/api';
import { count, money, shortDay } from '@/lib/format';

export const metadata: Metadata = { title: 'Money' };

interface Summary {
  days: number;
  held: { customerWalletsKobo: number; agentAvailableKobo: number; agentHeldKobo: number; escrowKobo: number };
  platform: { providerCashKobo: number; revenueKobo: number; providerFeesKobo: number; inTransitKobo: number };
  revenue: Array<{ kind: string; label: string; kobo: number }>;
  providerCharges: Array<{ kind: string; label: string; kobo: number }>;
  topUps: { count: number; kobo: number; feesKobo: number; senderMismatch: number };
  withdrawals: { count: number; kobo: number; failed: number; pending: number };
  daily: Array<{ day: string; revenueKobo: number; chargesKobo: number }>;
}

const PERIODS = [7, 30, 90];

export default async function MoneyPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const asked = Number((await searchParams).days);
  const days = PERIODS.includes(asked) ? asked : 30;
  const country = await getCountry();
  const s = await api<Summary>(`/admin/money/summary?country=${country.code}&days=${days}`);
  const naira = (kobo: number) => money(kobo, country.currency);
  const sum = (list: Array<{ kobo: number }>) => list.reduce((t, r) => t + r.kobo, 0);
  const owed = s.held.customerWalletsKobo + s.held.agentAvailableKobo + s.held.agentHeldKobo + s.held.escrowKobo;

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Held for people now">
          <div className="grid grid-cols-2 gap-5">
            <Stat label="Customer wallets" value={naira(s.held.customerWalletsKobo)} />
            <Stat label="Held on errands" value={naira(s.held.escrowKobo)} />
            <Stat label="Agents, available" value={naira(s.held.agentAvailableKobo)} />
            <Stat label="Agents, held" value={naira(s.held.agentHeldKobo)} />
          </div>
          <p className="mt-4 text-sm text-ink-3">
            Owed to people in all: <span className="num font-bold text-ink">{naira(owed)}</span>
          </p>
        </Card>
        <Card title="Jiffo's own accounts, all time">
          <div className="grid grid-cols-2 gap-5">
            <Stat label="Cash at the payment provider" value={naira(s.platform.providerCashKobo)} />
            <Stat label="Revenue" value={naira(s.platform.revenueKobo)} />
            <Stat label="Paid to the payment provider" value={naira(s.platform.providerFeesKobo)} />
            <Stat label="Withdrawals on the way" value={naira(s.platform.inTransitKobo)} />
          </div>
        </Card>
      </div>

      <div className="flex items-center gap-1.5" role="group" aria-label="Period">
        {PERIODS.map((p) => (
          <Link
            key={p}
            href={p === 30 ? '/money' : `/money?days=${p}`}
            aria-current={p === days ? 'true' : undefined}
            className={`h-8 rounded-full px-3 text-[13px] leading-8 font-semibold ${
              p === days ? 'bg-ink text-on-ink' : 'bg-surface text-ink-2 hover:bg-surface-2'
            }`}
          >
            Last {p} days
          </Link>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={`Revenue, last ${days} days`}>
          <ul className="num space-y-2 text-[15px]">
            {s.revenue.length === 0 ? <li className="text-ink-3">None yet.</li> : null}
            {s.revenue.map((r) => (
              <li key={r.kind} className="flex justify-between gap-3">
                <span className="text-ink-2">{r.label}</span>
                <span className="font-semibold">{naira(r.kobo)}</span>
              </li>
            ))}
            <li className="flex justify-between gap-3 border-t border-line pt-2 font-bold">
              <span>Total</span>
              <span>{naira(sum(s.revenue))}</span>
            </li>
          </ul>
        </Card>
        <Card title={`Payment provider charges, last ${days} days`}>
          <ul className="num space-y-2 text-[15px]">
            {s.providerCharges.length === 0 ? <li className="text-ink-3">None yet.</li> : null}
            {s.providerCharges.map((r) => (
              <li key={r.kind} className="flex justify-between gap-3">
                <span className="text-ink-2">{r.label}</span>
                <span className="font-semibold">{naira(r.kobo)}</span>
              </li>
            ))}
            <li className="flex justify-between gap-3 border-t border-line pt-2 font-bold">
              <span>Total</span>
              <span>{naira(sum(s.providerCharges))}</span>
            </li>
          </ul>
        </Card>
      </div>

      <Card title={`Revenue by day, last ${days} days`}>
        <ColumnChart
          title={`Revenue by day, last ${days} days`}
          empty="No revenue in this period"
          columns={s.daily.map((d) => ({ label: shortDay(d.day), value: d.revenueKobo, shown: naira(d.revenueKobo) }))}
        />
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card
          title={`Top-ups, last ${days} days`}
          action={
            <Link href="/money/top-ups" className="text-sm font-semibold underline">
              See all
            </Link>
          }
        >
          <div className="grid grid-cols-2 gap-5">
            <Stat label="Received" value={naira(s.topUps.kobo)} hint={`${count(s.topUps.count)} top-ups`} />
            <Stat
              label="Fees Jiffo paid"
              value={naira(s.topUps.feesKobo)}
              hint="The provider's charge, not passed on"
            />
            <Stat
              label="Sender name differed"
              value={count(s.topUps.senderMismatch)}
              tone={s.topUps.senderMismatch ? 'warn' : undefined}
              hint="Worth a look for fraud"
            />
          </div>
        </Card>
        <Card
          title={`Withdrawals, last ${days} days`}
          action={
            <Link href="/money/withdrawals" className="text-sm font-semibold underline">
              See all
            </Link>
          }
        >
          <div className="grid grid-cols-2 gap-5">
            <Stat
              label="Paid out"
              value={naira(s.withdrawals.kobo)}
              hint={`${count(s.withdrawals.count)} withdrawals`}
            />
            <Stat label="Waiting" value={count(s.withdrawals.pending)} />
            <Stat label="Failed" value={count(s.withdrawals.failed)} tone={s.withdrawals.failed ? 'warn' : undefined} />
          </div>
        </Card>
      </div>
    </div>
  );
}
