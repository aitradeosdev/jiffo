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
  platform: {
    providerCashKobo: number;
    revenueKobo: number;
    providerFeesKobo: number;
    inTransitKobo: number;
    netRevenueKobo: number;
  };
  earnings: { revenueKobo: number; providerChargesKobo: number; netRevenueKobo: number };
  revenue: Array<{ kind: string; label: string; kobo: number }>;
  providerCharges: Array<{ kind: string; label: string; kobo: number }>;
  topUps: {
    count: number;
    kobo: number;
    feesKobo: number;
    senderMismatch: number;
    oneTime: TopUpMethod;
    fixed: TopUpMethod;
  };
  fixedAccounts: { issued: number; issueCostKobo: number; active: number; pending: number; failed: number };
  withdrawals: { count: number; kobo: number; failed: number; pending: number };
  daily: Array<{ day: string; revenueKobo: number; chargesKobo: number; netKobo: number }>;
}
interface TopUpMethod {
  count: number;
  kobo: number;
  feesKobo: number;
}

const PERIODS = [7, 30, 90];

export default async function MoneyPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const asked = Number((await searchParams).days);
  const days = PERIODS.includes(asked) ? asked : 30;
  const country = await getCountry();
  const s = await api<Summary>(`/admin/money/summary?country=${country.code}&days=${days}`);
  const naira = (kobo: number) => money(kobo, country.currency);
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
            <Stat
              label="Net revenue"
              value={naira(s.platform.netRevenueKobo)}
              tone={s.platform.netRevenueKobo < 0 ? 'danger' : undefined}
              hint="Revenue less what the provider was paid"
            />
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

      <Card title={`What Jiffo made, last ${days} days`}>
        <div className="grid grid-cols-2 gap-5 sm:grid-cols-3">
          <Stat label="Revenue" value={naira(s.earnings.revenueKobo)} hint="Fees and commission earned" />
          <Stat
            label="Payment provider costs"
            value={naira(s.earnings.providerChargesKobo)}
            hint="Top-up and transfer fees, account numbers issued"
          />
          <Stat
            label="Net revenue"
            value={naira(s.earnings.netRevenueKobo)}
            tone={s.earnings.netRevenueKobo < 0 ? 'danger' : undefined}
            hint="Revenue less those costs"
          />
        </div>
      </Card>

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
              <span>{naira(s.earnings.revenueKobo)}</span>
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
              <span>{naira(s.earnings.providerChargesKobo)}</span>
            </li>
          </ul>
        </Card>
      </div>

      <Card title={`Net revenue by day, last ${days} days`}>
        {/* A day that cost more than it earned has no column; its tooltip shows the loss. */}
        <ColumnChart
          title={`Net revenue by day, last ${days} days`}
          empty="Nothing earned after costs in this period"
          columns={s.daily.map((d) => ({ label: shortDay(d.day), value: d.netKobo, shown: naira(d.netKobo) }))}
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
              label="To one-time account numbers"
              value={naira(s.topUps.oneTime.kobo)}
              hint={`${count(s.topUps.oneTime.count)} top-ups, ${naira(s.topUps.oneTime.feesKobo)} in fees`}
            />
            <Stat
              label="To own account numbers"
              value={naira(s.topUps.fixed.kobo)}
              hint={`${count(s.topUps.fixed.count)} transfers, ${naira(s.topUps.fixed.feesKobo)} in fees`}
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

      <Card title="Customers' own account numbers">
        <div className="grid grid-cols-2 gap-5 sm:grid-cols-4">
          <Stat
            label="In use"
            value={count(s.fixedAccounts.active)}
            hint={`${count(s.fixedAccounts.pending)} being issued`}
          />
          <Stat label={`Issued, last ${days} days`} value={count(s.fixedAccounts.issued)} />
          <Stat
            label={`Cost to issue, last ${days} days`}
            value={naira(s.fixedAccounts.issueCostKobo)}
            hint="The fee set on the provider, per account"
          />
          <Stat
            label={`Couldn't be issued, last ${days} days`}
            value={count(s.fixedAccounts.failed)}
            tone={s.fixedAccounts.failed ? 'warn' : undefined}
            hint="Usually a BVN that didn't match"
          />
        </div>
      </Card>
    </div>
  );
}
