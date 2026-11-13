import type { Metadata } from 'next';
import Link from 'next/link';
import { agentTierLabel } from '@jiffo/shared';
import { ListControls, Pager } from '@/components/list-controls';
import { Badge, Card, Empty, PageHeader, tableClass, tdClass, thClass } from '@/components/ui';
import { api, getCountry } from '@/lib/api';
import { nameOf } from '@/lib/errands';
import { dateTime, money } from '@/lib/format';
import { listLink } from '@/lib/links';

export const metadata: Metadata = { title: 'People' };

const ROLES = [
  { value: 'customer', label: 'Customers' },
  { value: 'agent', label: 'Agents' },
] as const;

interface Row {
  id: string;
  firstName: string | null;
  lastName: string | null;
  phone: string;
  status: 'active' | 'suspended';
  createdAt: string;
  online: boolean;
  errands: number;
  rating: number | null;
  balanceKobo: number;
  tier?: string;
}

export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string; q?: string; before?: string }>;
}) {
  const params = await searchParams;
  const role = params.role === 'agent' ? 'agent' : 'customer';
  const q = (params.q ?? '').trim().slice(0, 80);
  const country = await getCountry();
  const query = new URLSearchParams({ country: country.code, role, ...(q ? { q } : {}) });
  if (params.before) query.set('before', params.before);
  const page = await api<{ people: Row[]; next: string | null }>(`/admin/people?${query}`);
  const link = (changes: Record<string, string | null>) =>
    listLink('/people', { role, q }, changes, { role: 'customer' });
  const agents = role === 'agent';

  return (
    <>
      <PageHeader title="People" subtitle={`Customers and agents in ${country.name}, newest first.`} />
      <ListControls
        base="/people"
        label="Customers or agents"
        filters={ROLES}
        current={role}
        link={(r) => link({ role: r, before: null, q: null })}
        q={q}
        searchLabel="Search people"
        placeholder="Name, phone or email"
        hidden={agents ? { role: 'agent' } : undefined}
      />
      <Card padded={false}>
        {page.people.length === 0 ? (
          <Empty title={q ? `Nobody matches “${q}”` : agents ? 'No agents yet' : 'No customers yet'} />
        ) : (
          <div className="overflow-x-auto">
            <table className={tableClass}>
              <thead className="border-b border-line">
                <tr>
                  <th className={thClass}>Name</th>
                  {agents ? <th className={thClass}>Tier</th> : null}
                  <th className={`${thClass} text-right`}>{agents ? 'Completed' : 'Errands'}</th>
                  <th className={`${thClass} text-right`}>Rating</th>
                  <th className={`${thClass} text-right`}>{agents ? 'Balance' : 'Wallet'}</th>
                  <th className={thClass}>Joined</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {page.people.map((p) => (
                  <tr key={p.id} className="hover:bg-surface-2/60">
                    <td className={tdClass}>
                      <Link href={`/people/${p.id}`} className="flex items-center gap-2 font-bold hover:underline">
                        {nameOf(p)}
                        {agents && p.online ? (
                          <span className="size-2 rounded-full bg-chart" title="Online now" aria-label="Online now" />
                        ) : null}
                      </Link>
                      <span className="num text-[13px] text-ink-3">{p.phone}</span>
                      {p.status === 'suspended' ? (
                        <span className="ml-2">
                          <Badge tone="danger">Suspended</Badge>
                        </span>
                      ) : null}
                    </td>
                    {agents ? (
                      <td className={tdClass}>
                        <Badge>{agentTierLabel(p.tier ?? 'bronze')}</Badge>
                      </td>
                    ) : null}
                    <td className={`${tdClass} num text-right`}>{p.errands}</td>
                    <td className={`${tdClass} num text-right`}>{p.rating ? `${p.rating} ★` : '—'}</td>
                    <td className={`${tdClass} num text-right font-semibold`}>
                      {money(p.balanceKobo, country.currency)}
                    </td>
                    <td className={`${tdClass} num whitespace-nowrap text-ink-3`}>
                      {dateTime(p.createdAt, country.timezone)}
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
