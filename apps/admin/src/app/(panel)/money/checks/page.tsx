import type { Metadata } from 'next';
import { Badge, Card, Empty, Notice, tableClass, tdClass, thClass } from '@/components/ui';
import { api, getCountry, getMe } from '@/lib/api';
import { dateTime, money } from '@/lib/format';
import { ClearCheckForm, ResolveAlertForm } from './forms';

export const metadata: Metadata = { title: 'Nightly checks' };

interface Run {
  id: string;
  provider: string;
  providerBalanceKobo: number;
  ledgerCashKobo: number;
  inTransitKobo: number;
  differenceKobo: number;
  pendingDeposits: number;
  stuckPayouts: number;
  pausesInstant: boolean;
  clearedAt: string | null;
  clearNote: string | null;
  createdAt: string;
}

interface Alert {
  id: string;
  kind: string;
  message: string;
  createdAt: string;
  resolvedAt: string | null;
  resolveNote: string | null;
}

/** What each kind of alert is about, in a few words. */
const ALERT_KINDS: Record<string, string> = {
  reconciliation_gap: 'Nightly check gap',
  low_provider_balance: 'Low balance at the provider',
  payout_rejected: 'Transfer refused by the approval URL',
  payout_unclear: 'Withdrawal in an unclear state',
  transfer_otp_on: 'Transfer OTP is on',
};

const DONE: Record<string, string> = {
  cleared: 'Check cleared.',
  resolved: 'Alert resolved.',
};

export default async function ChecksPage({ searchParams }: { searchParams: Promise<{ done?: string }> }) {
  const [country, me, params] = await Promise.all([getCountry(), getMe(), searchParams]);
  const [runs, { alerts }] = await Promise.all([
    api<Run[]>(`/admin/money/reconciliation?country=${country.code}`),
    api<{ alerts: Alert[] }>(`/admin/alerts?country=${country.code}`),
  ]);
  const naira = (kobo: number) => money(kobo, country.currency);
  const canAct = me.permissions.includes('money');
  const pausing = runs.filter((r) => r.pausesInstant && !r.clearedAt);
  const open = alerts.filter((a) => !a.resolvedAt);
  const done = DONE[params.done ?? ''];
  return (
    <>
      <p className="mb-4 max-w-3xl text-[15px] text-ink-3">
        Every night the cash the ledger says Jiffo has at the payment provider is compared with the balance the provider
        reports. A shortfall beyond the tolerance in Settings, Security pauses instant withdrawals until finance clears
        it. Alerts about money that needs a person collect here too.
      </p>
      {done ? (
        <div className="mb-4">
          <Notice tone="brand">{done}</Notice>
        </div>
      ) : null}
      {pausing.length ? (
        <div className="mb-6">
          <Card title="Instant withdrawals are paused">
            <p className="text-sm text-ink-2">
              The provider held less than the ledger at {pausing.length === 1 ? 'this check' : 'these checks'}. Daily
              withdrawals still go out. Find what explains the gap, then clear {pausing.length === 1 ? 'it' : 'each'}.
            </p>
            <ul className="mt-3 space-y-4">
              {pausing.map((r) => (
                <li key={r.id}>
                  <p className="text-sm">
                    <span className="num font-bold text-danger">{naira(r.differenceKobo)}</span> on{' '}
                    {dateTime(r.createdAt, country.timezone)}
                  </p>
                  {canAct ? (
                    <ClearCheckForm id={r.id} />
                  ) : (
                    <p className="text-[13px] text-ink-3">Finance or an owner can clear it.</p>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      ) : null}
      <div className="mb-6">
        <Card title={open.length ? `Alerts (${open.length} open)` : 'Alerts'}>
          {alerts.length === 0 ? (
            <p className="text-sm text-ink-3">No alerts.</p>
          ) : (
            <ul className="divide-y divide-line">
              {alerts.slice(0, 30).map((a) => (
                <li key={a.id} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-bold">{ALERT_KINDS[a.kind] ?? a.kind}</span>
                    {a.resolvedAt ? <Badge>Resolved</Badge> : <Badge tone="warn">Open</Badge>}
                    <span className="num text-[13px] text-ink-3">{dateTime(a.createdAt, country.timezone)}</span>
                  </div>
                  <p className="mt-1 text-sm text-ink-2">{a.message}</p>
                  {a.resolvedAt ? (
                    <p className="mt-1 text-[13px] text-ink-3">{a.resolveNote}</p>
                  ) : canAct ? (
                    <ResolveAlertForm id={a.id} />
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <Card padded={false}>
        {runs.length === 0 ? (
          <Empty title="No checks have run yet">The first one runs tonight.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className={tableClass}>
              <thead className="border-b border-line">
                <tr>
                  <th className={thClass}>When</th>
                  <th className={`${thClass} text-right`}>Provider says</th>
                  <th className={`${thClass} text-right`}>Ledger says</th>
                  <th className={`${thClass} text-right`}>On the way out</th>
                  <th className={`${thClass} text-right`}>Difference</th>
                  <th className={thClass}>Loose ends</th>
                  <th className={thClass}>Instant withdrawals</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {runs.map((r) => (
                  <tr key={r.id}>
                    <td className={`${tdClass} num whitespace-nowrap`}>{dateTime(r.createdAt, country.timezone)}</td>
                    <td className={`${tdClass} num text-right`}>{naira(r.providerBalanceKobo)}</td>
                    <td className={`${tdClass} num text-right`}>{naira(r.ledgerCashKobo)}</td>
                    <td className={`${tdClass} num text-right`}>{naira(r.inTransitKobo)}</td>
                    <td className={`${tdClass} num text-right`}>
                      {r.differenceKobo === 0 ? (
                        <Badge tone="brand">Matches</Badge>
                      ) : (
                        <span className="font-bold text-danger">{naira(r.differenceKobo)}</span>
                      )}
                    </td>
                    <td className={`${tdClass} text-[13px] text-ink-3`}>
                      {r.pendingDeposits || r.stuckPayouts
                        ? [
                            r.pendingDeposits ? `${r.pendingDeposits} top-ups waiting` : null,
                            r.stuckPayouts ? `${r.stuckPayouts} withdrawals stuck` : null,
                          ]
                            .filter(Boolean)
                            .join(' · ')
                        : 'None'}
                    </td>
                    <td className={`${tdClass} text-[13px]`}>
                      {!r.pausesInstant ? (
                        <span className="text-ink-3">Not paused</span>
                      ) : r.clearedAt ? (
                        <span className="text-ink-3">Cleared: {r.clearNote}</span>
                      ) : (
                        <Badge tone="danger">Paused</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
