import type { Metadata } from 'next';
import Link from 'next/link';
import { ListControls, Pager } from '@/components/list-controls';
import { Badge, Card, Empty, tableClass, tdClass, thClass } from '@/components/ui';
import { api, getCountry } from '@/lib/api';
import { nameOf, type PersonRef } from '@/lib/errands';
import { dateTime, money } from '@/lib/format';
import { listLink } from '@/lib/links';

export const metadata: Metadata = { title: 'Top-ups' };

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Waiting' },
  { value: 'expired', label: 'Expired' },
  { value: 'failed', label: 'Failed' },
  { value: 'mismatch', label: 'Sender name differs' },
] as const;
const STATUS = {
  pending: { label: 'Waiting for transfer', tone: 'neutral' },
  succeeded: { label: 'Received', tone: 'brand' },
  failed: { label: 'Failed', tone: 'danger' },
  expired: { label: 'Expired, never paid', tone: 'neutral' },
} as const;

interface Deposit {
  id: string;
  createdAt: string;
  status: keyof typeof STATUS;
  reference: string;
  amountKobo: number;
  paidKobo: number | null;
  feesKobo: number | null;
  senderName: string | null;
  senderBank: string | null;
  senderMismatch: boolean;
  person: PersonRef;
}

export default async function TopUpsPage({
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
  const page = await api<{ deposits: Deposit[]; next: string | null }>(`/admin/money/deposits?${query}`);
  const naira = (kobo: number) => money(kobo, country.currency);
  const current = { filter, q };
  const link = (changes: Record<string, string | null>) =>
    listLink('/money/top-ups', current, changes, { filter: 'all' });

  return (
    <>
      <ListControls
        base="/money/top-ups"
        label="Filter top-ups"
        filters={FILTERS}
        current={filter}
        link={(f) => link({ filter: f, before: null })}
        q={q}
        searchLabel="Search top-ups"
        placeholder="Name, phone or reference"
        hidden={filter !== 'all' ? { filter } : undefined}
      />
      <Card padded={false}>
        {page.deposits.length === 0 ? (
          <Empty title={q ? `Nothing matches “${q}”` : 'No top-ups here'} />
        ) : (
          <div className="overflow-x-auto">
            <table className={tableClass}>
              <thead className="border-b border-line">
                <tr>
                  <th className={thClass}>Customer</th>
                  <th className={thClass}>Status</th>
                  <th className={`${thClass} text-right`}>Received</th>
                  <th className={`${thClass} text-right`}>Fee Jiffo paid</th>
                  <th className={thClass}>Sent from</th>
                  <th className={thClass}>When</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {page.deposits.map((d) => (
                  <tr key={d.id}>
                    <td className={tdClass}>
                      <Link href={`/people/${d.person.id}`} className="font-bold hover:underline">
                        {nameOf(d.person)}
                      </Link>
                      <div className="num text-[13px] text-ink-3">{d.reference}</div>
                    </td>
                    <td className={tdClass}>
                      <Badge tone={STATUS[d.status].tone}>{STATUS[d.status].label}</Badge>
                    </td>
                    <td className={`${tdClass} num text-right font-semibold`}>
                      {d.paidKobo !== null ? (
                        naira(d.paidKobo)
                      ) : (
                        <span className="text-ink-3">{naira(d.amountKobo)} asked</span>
                      )}
                    </td>
                    <td className={`${tdClass} num text-right`}>{d.feesKobo !== null ? naira(d.feesKobo) : '—'}</td>
                    <td className={tdClass}>
                      {d.senderName ? (
                        <>
                          <div>{d.senderName}</div>
                          <div className="text-[13px] text-ink-3">{d.senderBank}</div>
                        </>
                      ) : (
                        <span className="text-ink-3">—</span>
                      )}
                      {d.senderMismatch ? (
                        <span className="mt-1 inline-block">
                          <Badge tone="warn">Name differs</Badge>
                        </span>
                      ) : null}
                    </td>
                    <td className={`${tdClass} num whitespace-nowrap text-ink-3`}>
                      {dateTime(d.createdAt, country.timezone)}
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
