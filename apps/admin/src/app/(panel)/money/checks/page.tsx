import type { Metadata } from 'next';
import { Badge, Card, Empty, tableClass, tdClass, thClass } from '@/components/ui';
import { api, getCountry } from '@/lib/api';
import { dateTime, money } from '@/lib/format';

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
  createdAt: string;
}

export default async function ChecksPage() {
  const country = await getCountry();
  const runs = await api<Run[]>(`/admin/money/reconciliation?country=${country.code}`);
  const naira = (kobo: number) => money(kobo, country.currency);
  return (
    <>
      <p className="mb-4 max-w-3xl text-[15px] text-ink-3">
        Every night the cash the ledger says Jiffo has at the payment provider is compared with the balance the provider
        reports. Any difference needs looking into.
      </p>
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
