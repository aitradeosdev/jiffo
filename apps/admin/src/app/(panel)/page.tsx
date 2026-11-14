import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { ColumnChart } from '@/components/column-chart';
import { AlertIcon, CheckIcon } from '@/components/icons';
import { Card, PageHeader, Stat } from '@/components/ui';
import { api, getCountry } from '@/lib/api';
import { ago, count, money, shortDay } from '@/lib/format';

export const metadata: Metadata = { title: 'Overview' };

interface Overview {
  errands: {
    waiting: number;
    live: number;
    disputed: number;
    requestedToday: number;
    completedToday: number;
    cancelledToday: number;
    expiredToday: number;
  };
  agents: { online: number; onErrand: number };
  today: {
    errandFeesKobo: number;
    revenueKobo: number;
    providerCostsKobo: number;
    netRevenueKobo: number;
    topUps: number;
    topUpsKobo: number;
    absorbedFeesKobo: number;
    payouts: number;
    payoutsKobo: number;
  };
  balances: { customerWalletsKobo: number; agentBalancesKobo: number; escrowKobo: number };
  attention: {
    disputes: number;
    failedPayouts7d: number;
    senderMismatch7d: number;
    applications: number;
    idChecks: number;
    alerts: number;
    instantPaused: boolean;
  };
  week: Array<{ day: string; completed: number; revenueKobo: number; costsKobo: number; netRevenueKobo: number }>;
  reconciliation: { at: string; differenceKobo: number; pendingDeposits: number; stuckPayouts: number } | null;
}

const plural = (n: number, one: string, many = `${one}s`) => `${count(n)} ${n === 1 ? one : many}`;

export default async function OverviewPage() {
  const country = await getCountry();
  const o = await api<Overview>(`/admin/overview?country=${country.code}`);
  const naira = (kobo: number) => money(kobo, country.currency);
  const now = new Intl.DateTimeFormat('en-GB', {
    timeZone: country.timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date());

  const attention: ReactNode[] = [];
  if (o.attention.disputes)
    attention.push(
      <Link href="/disputes" className="underline">
        {plural(o.attention.disputes, 'errand')} in dispute, waiting for a decision
      </Link>,
    );
  if (o.attention.applications)
    attention.push(
      <Link href="/applications" className="underline">
        {plural(o.attention.applications, 'agent application')} waiting for review
      </Link>,
    );
  if (o.attention.idChecks)
    attention.push(
      <Link href="/id-checks" className="underline">
        {plural(o.attention.idChecks, "customer's ID check", "customers' ID checks")} waiting for review
      </Link>,
    );
  if (o.attention.instantPaused)
    attention.push(
      <Link href="/money/checks" className="underline">
        Instant withdrawals are paused until finance clears the nightly check
      </Link>,
    );
  if (o.attention.alerts)
    attention.push(
      <Link href="/money/checks" className="underline">
        {plural(o.attention.alerts, 'money alert')} to look at
      </Link>,
    );
  if (o.attention.failedPayouts7d)
    attention.push(`${plural(o.attention.failedPayouts7d, 'withdrawal')} failed in the last 7 days`);
  if (o.attention.senderMismatch7d)
    attention.push(
      `${plural(o.attention.senderMismatch7d, 'top-up')} from a sender with a different name in the last 7 days`,
    );
  if (o.reconciliation && o.reconciliation.differenceKobo !== 0)
    attention.push(`The last money check found a difference of ${naira(o.reconciliation.differenceKobo)}`);

  return (
    <>
      <PageHeader title="Overview" subtitle={`${country.name} · today so far, as of ${now}`} />

      <div className="space-y-6">
        {attention.length ? (
          <section aria-label="Needs attention" className="rounded-2xl border border-warn/30 bg-warn-soft p-4">
            <ul className="space-y-1.5">
              {attention.map((line, i) => (
                <li key={i} className="flex items-start gap-2 text-[15px] font-semibold text-warn">
                  <AlertIcon />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <p className="flex items-center gap-2 text-[15px] font-semibold text-brand-ink">
            <CheckIcon /> Nothing needs attention right now
          </p>
        )}

        <div className="grid gap-6 lg:grid-cols-3">
          <Card title="Errands now" className="lg:col-span-2">
            <div className="grid grid-cols-2 gap-5 sm:grid-cols-3">
              <Stat label="Waiting for an agent" value={count(o.errands.waiting)} />
              <Stat label="With an agent" value={count(o.errands.live)} />
              <Stat
                label="In dispute"
                value={count(o.errands.disputed)}
                tone={o.errands.disputed ? 'warn' : undefined}
              />
            </div>
          </Card>
          <Card title="Agents">
            <div className="grid grid-cols-2 gap-5">
              <Stat label="Online" value={count(o.agents.online)} />
              <Stat label="On an errand" value={count(o.agents.onErrand)} />
            </div>
          </Card>
        </div>

        <Card title="Today">
          <div className="grid grid-cols-2 gap-5 sm:grid-cols-4">
            <Stat label="Requested" value={count(o.errands.requestedToday)} />
            <Stat label="Completed" value={count(o.errands.completedToday)} />
            <Stat label="Cancelled" value={count(o.errands.cancelledToday)} />
            <Stat label="No agent found" value={count(o.errands.expiredToday)} />
          </div>
          <div className="my-5 border-t border-line" />
          <div className="grid grid-cols-2 gap-5 sm:grid-cols-4">
            <Stat
              label="Net revenue"
              value={naira(o.today.netRevenueKobo)}
              tone={o.today.netRevenueKobo < 0 ? 'danger' : undefined}
              hint={`${naira(o.today.revenueKobo)} earned, less ${naira(o.today.providerCostsKobo)} in payment provider costs`}
            />
            <Stat label="Errand fees paid" value={naira(o.today.errandFeesKobo)} hint="On errands completed today" />
            <Stat
              label="Top-ups"
              value={naira(o.today.topUpsKobo)}
              hint={`${plural(o.today.topUps, 'top-up')} · Jiffo paid ${naira(o.today.absorbedFeesKobo)} in fees`}
            />
            <Stat
              label="Withdrawals paid"
              value={naira(o.today.payoutsKobo)}
              hint={plural(o.today.payouts, 'withdrawal')}
            />
          </div>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card title="Completed errands, last 7 days">
            <ColumnChart
              title="Completed errands, last 7 days"
              empty="No completed errands this week"
              columns={o.week.map((d) => ({ label: shortDay(d.day), value: d.completed, shown: count(d.completed) }))}
            />
          </Card>
          <Card title="Net revenue, last 7 days">
            {/* Revenue less payment provider costs. A day that cost more than it earned has no column. */}
            <ColumnChart
              title="Net revenue, last 7 days"
              empty="Nothing earned after costs this week"
              columns={o.week.map((d) => ({
                label: shortDay(d.day),
                value: d.netRevenueKobo,
                shown: naira(d.netRevenueKobo),
              }))}
            />
          </Card>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card title="Money Jiffo holds for people">
            <div className="grid grid-cols-2 gap-5 sm:grid-cols-3">
              <Stat label="Customer wallets" value={naira(o.balances.customerWalletsKobo)} />
              <Stat label="Agent balances" value={naira(o.balances.agentBalancesKobo)} />
              <Stat label="Held on errands" value={naira(o.balances.escrowKobo)} />
            </div>
          </Card>
          <Card title="Nightly money check">
            {o.reconciliation ? (
              <div className="grid grid-cols-2 gap-5 sm:grid-cols-3">
                <Stat
                  label="Difference"
                  value={naira(o.reconciliation.differenceKobo)}
                  tone={o.reconciliation.differenceKobo !== 0 ? 'danger' : undefined}
                  hint={`Checked ${ago(o.reconciliation.at, country.timezone)}`}
                />
                <Stat label="Top-ups pending" value={count(o.reconciliation.pendingDeposits)} />
                <Stat label="Withdrawals stuck" value={count(o.reconciliation.stuckPayouts)} />
              </div>
            ) : (
              <p className="text-[15px] text-ink-3">
                The ledger hasn&apos;t been checked against the payment provider yet. It runs every night.
              </p>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
