import type { Metadata } from 'next';
import Link from 'next/link';
import { ListControls, Pager } from '@/components/list-controls';
import { Badge, Card, Empty, tableClass, tdClass, thClass } from '@/components/ui';
import { api, getCountry } from '@/lib/api';
import { nameOf, type PersonRef } from '@/lib/errands';
import { dateTime, money } from '@/lib/format';
import { listLink } from '@/lib/links';

export const metadata: Metadata = { title: 'Withdrawals' };

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Waiting' },
  { value: 'failed', label: 'Failed' },
] as const;
const STATUS = {
  requested: { label: 'Scheduled', tone: 'neutral' },
  processing: { label: 'Sending', tone: 'neutral' },
  succeeded: { label: 'Paid', tone: 'brand' },
  failed: { label: 'Failed, returned', tone: 'danger' },
} as const;

interface Payout {
  id: string;
  createdAt: string;
  status: keyof typeof STATUS;
  speed: 'instant' | 'scheduled';
  reference: string;
  amountKobo: number;
  feeKobo: number;
  sendKobo: number;
  failureReason: string | null;
  bankName: string;
  accountName: string;
  accountLast4: string;
  person: PersonRef;
}

export default async function WithdrawalsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; q?: string; before?: string }>;
}) {
  const p = await searchParams;
  const filter = FILTERS.some((f) => f.value === p.filter) ? p.filter! : 'all';
  const q = (p.q ?? '').trim().slice(0, 80);
  const country = await getCountry();
  const query = new URLSearchParams({
    country: country.code,
    filter,
    ...(q ? { q } : {}),
    ...(p.before ? { before: p.before } : {}),
  });
  const page = await api<{ payouts: Payout[]; next: string | null }>(`/admin/money/payouts?${query}`);
  const naira = (kobo: number) => money(kobo, country.currency);
  const link = (changes: Record<string, string | null>) =>
    listLink('/money/withdrawals', { filter, q }, changes, { filter: 'all' });

  return (
    <>
      <ListControls
        base="/money/withdrawals"
        label="Filter withdrawals"
        filters={FILTERS}
        current={filter}
        link={(f) => link({ filter: f, before: null })}
        q={q}
        searchLabel="Search withdrawals"
        placeholder="Name, phone or reference"
        hidden={filter !== 'all' ? { filter } : undefined}
      />
      <Card padded={false}>
        {page.payouts.length === 0 ? (
          <Empty title={q ? `Nothing matches “${q}”` : 'No withdrawals here'} />
        ) : (
          <div className="overflow-x-auto">
            <table className={tableClass}>
              <thead className="border-b border-line">
                <tr>
                  <th className={thClass}>Agent</th>
                  <th className={thClass}>Status</th>
                  <th className={`${thClass} text-right`}>Amount</th>
                  <th className={`${thClass} text-right`}>Fee</th>
                  <th className={thClass}>To</th>
                  <th className={thClass}>When</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {page.payouts.map((w) => (
                  <tr key={w.id}>
                    <td className={tdClass}>
                      <Link href={`/people/${w.person.id}`} className="font-bold hover:underline">
                        {nameOf(w.person)}
                      </Link>
                      <div className="num text-[13px] text-ink-3">{w.reference}</div>
                    </td>
                    <td className={tdClass}>
                      <Badge tone={STATUS[w.status].tone}>{STATUS[w.status].label}</Badge>
                      <div className="mt-1 text-[13px] text-ink-3">
                        {w.speed === 'instant' ? 'Instant' : 'Daily batch'}
                      </div>
                      {w.failureReason ? <div className="text-[13px] text-danger">{w.failureReason}</div> : null}
                    </td>
                    <td className={`${tdClass} num text-right font-semibold`}>{naira(w.amountKobo)}</td>
                    <td className={`${tdClass} num text-right`}>{w.feeKobo ? naira(w.feeKobo) : 'Free'}</td>
                    <td className={tdClass}>
                      <div>{w.accountName}</div>
                      <div className="num text-[13px] text-ink-3">
                        {w.bankName} ····{w.accountLast4}
                      </div>
                    </td>
                    <td className={`${tdClass} num whitespace-nowrap text-ink-3`}>
                      {dateTime(w.createdAt, country.timezone)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Pager newest={p.before ? link({ before: null }) : null} older={page.next ? link({ before: page.next }) : null} />
    </>
  );
}
