import type { Metadata } from 'next';
import Link from 'next/link';
import type { ErrandState } from '@jiffo/shared';
import { ListControls, Pager } from '@/components/list-controls';
import { Badge, Card, Empty, PageHeader, tableClass, tdClass, thClass } from '@/components/ui';
import { api, getCountry } from '@/lib/api';
import { getCategories, nameOf, STATUS, type PersonRef } from '@/lib/errands';
import { dateTime, money } from '@/lib/format';
import { listLink } from '@/lib/links';

export const metadata: Metadata = { title: 'Errands' };

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'waiting', label: 'Waiting' },
  { value: 'live', label: 'With an agent' },
  { value: 'disputed', label: 'In dispute' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
] as const;

interface Row {
  id: string;
  createdAt: string;
  status: ErrandState;
  description: string;
  categoryKey: string;
  buy: boolean;
  urgent: boolean;
  feeKobo: number;
  serviceFeeKobo: number;
  customer: PersonRef;
  agent: PersonRef | null;
}

export default async function ErrandsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; q?: string; before?: string }>;
}) {
  const params = await searchParams;
  const filter = FILTERS.some((f) => f.value === params.filter) ? params.filter! : 'all';
  const q = (params.q ?? '').trim().slice(0, 80);
  const country = await getCountry();
  const query = new URLSearchParams({ country: country.code, filter, ...(q ? { q } : {}) });
  if (params.before) query.set('before', params.before);
  const [page, categories] = await Promise.all([
    api<{ errands: Row[]; next: string | null }>(`/admin/errands?${query}`),
    getCategories(country.code),
  ]);
  const link = (changes: Record<string, string | null>) =>
    listLink('/errands', { filter, q }, changes, { filter: 'all' });

  return (
    <>
      <PageHeader title="Errands" subtitle={`Every errand in ${country.name}, newest first.`} />
      <ListControls
        base="/errands"
        label="Filter errands"
        filters={FILTERS}
        current={filter}
        link={(f) => link({ filter: f, before: null })}
        q={q}
        searchLabel="Search errands"
        placeholder="Errand id, phone, name or words"
        hidden={filter !== 'all' ? { filter } : undefined}
      />
      <Card padded={false}>
        {page.errands.length === 0 ? (
          <Empty title={q ? `Nothing matches “${q}”` : 'No errands here yet'} />
        ) : (
          <div className="overflow-x-auto">
            <table className={tableClass}>
              <thead className="border-b border-line">
                <tr>
                  <th className={thClass}>Errand</th>
                  <th className={thClass}>Status</th>
                  <th className={thClass}>Customer</th>
                  <th className={thClass}>Agent</th>
                  <th className={`${thClass} text-right`}>Fee</th>
                  <th className={thClass}>Requested</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {page.errands.map((e) => (
                  <tr key={e.id} className="hover:bg-surface-2/60">
                    <td className={`${tdClass} max-w-[340px]`}>
                      <Link href={`/errands/${e.id}`} className="block font-bold hover:underline">
                        <span className="line-clamp-1">{e.description}</span>
                      </Link>
                      <span className="text-[13px] text-ink-3">
                        {categories.get(e.categoryKey) ?? e.categoryKey}
                        {e.buy ? ' · buys items' : ''}
                        {e.urgent ? ' · urgent' : ''}
                      </span>
                    </td>
                    <td className={tdClass}>
                      <Badge tone={STATUS[e.status]?.tone}>{STATUS[e.status]?.label ?? e.status}</Badge>
                    </td>
                    <td className={tdClass}>
                      <div className="font-semibold">{nameOf(e.customer)}</div>
                      <div className="num text-[13px] text-ink-3">{e.customer.phone}</div>
                    </td>
                    <td className={tdClass}>
                      {e.agent ? (
                        <>
                          <div className="font-semibold">{nameOf(e.agent)}</div>
                          <div className="num text-[13px] text-ink-3">{e.agent.phone}</div>
                        </>
                      ) : (
                        <span className="text-ink-3">—</span>
                      )}
                    </td>
                    <td className={`${tdClass} num text-right font-semibold`}>{money(e.feeKobo, country.currency)}</td>
                    <td className={`${tdClass} num whitespace-nowrap text-ink-3`}>
                      {dateTime(e.createdAt, country.timezone)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Pager
        newest={params.before ? link({ before: null }) : null}
        older={page.next ? link({ before: page.next }) : null}
      />
    </>
  );
}
