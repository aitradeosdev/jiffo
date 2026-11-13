import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge, buttonClass, Card, Empty, inputClass, PageHeader, tableClass, tdClass, thClass } from '@/components/ui';
import { api, getCountry } from '@/lib/api';
import { nameOf, TIER } from '@/lib/errands';
import { dateTime, money } from '@/lib/format';

export const metadata: Metadata = { title: 'People' };

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
  const link = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams({ role, ...(q ? { q } : {}) });
    for (const [k, v] of Object.entries(changes)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    if (next.get('role') === 'customer') next.delete('role');
    const s = next.toString();
    return s ? `/people?${s}` : '/people';
  };
  const agents = role === 'agent';

  return (
    <>
      <PageHeader title="People" subtitle={`Customers and agents in ${country.name}, newest first.`} />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Customers or agents" className="flex gap-1.5">
          {(['customer', 'agent'] as const).map((r) => (
            <Link
              key={r}
              href={link({ role: r, before: null, q: null })}
              aria-current={r === role ? 'page' : undefined}
              className={`h-9 rounded-full px-3.5 text-sm leading-9 font-semibold ${
                r === role ? 'bg-ink text-on-ink' : 'bg-surface text-ink-2 hover:bg-surface-2'
              }`}
            >
              {r === 'customer' ? 'Customers' : 'Agents'}
            </Link>
          ))}
        </nav>
        <form action="/people" className="flex w-full gap-2 sm:w-auto" role="search">
          {agents ? <input type="hidden" name="role" value="agent" /> : null}
          <label htmlFor="q" className="sr-only">
            Search people
          </label>
          <input
            id="q"
            name="q"
            defaultValue={q}
            placeholder="Name, phone or email"
            className={`${inputClass} h-9 sm:w-72`}
          />
          <button type="submit" className={buttonClass('primary', true)}>
            Search
          </button>
        </form>
      </div>
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
                        <Badge>{TIER[p.tier ?? 'bronze'] ?? p.tier}</Badge>
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
      <div className="mt-4 flex gap-2">
        {params.before ? (
          <Link href={link({ before: null })} className={buttonClass('secondary', true)}>
            Newest
          </Link>
        ) : null}
        {page.next ? (
          <Link href={link({ before: page.next })} className={buttonClass('secondary', true)}>
            Older
          </Link>
        ) : null}
      </div>
    </>
  );
}
