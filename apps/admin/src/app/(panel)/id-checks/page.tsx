import type { Metadata } from 'next';
import Link from 'next/link';
import { ListControls, Pager } from '@/components/list-controls';
import { Badge, Card, Empty, PageHeader, tableClass, tdClass, thClass } from '@/components/ui';
import { api, getCountry } from '@/lib/api';
import { OUTCOME, type Check } from '@/lib/applications';
import { ID_CHECK_STATUS, type IdCheckStatus } from '@/lib/id-checks';
import { nameOf } from '@/lib/errands';
import { dateTime } from '@/lib/format';
import { listLink } from '@/lib/links';

export const metadata: Metadata = { title: 'ID checks' };

const ORDER: IdCheckStatus[] = ['review', 'checking', 'failed', 'verified', 'declined'];

interface Row {
  id: string;
  firstName: string | null;
  lastName: string | null;
  phone: string;
  legalName: string | null;
  status: IdCheckStatus;
  idName: string;
  provider: string;
  flagged: Check[];
  checkedAt: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
}

/** How long it has waited, roughly: "40 min", "5 h", "3 days". */
function waited(iso: string, now = Date.now()) {
  const minutes = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 48 * 60) return `${Math.floor(minutes / 60)} h`;
  return `${Math.floor(minutes / (24 * 60))} days`;
}

/** Customers' ID checks by state; the ones in review are support's queue. */
export default async function IdChecksPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; before?: string }>;
}) {
  const params = await searchParams;
  const status = ORDER.find((s) => s === params.status) ?? 'review';
  const q = (params.q ?? '').trim().slice(0, 80);
  const country = await getCountry();
  const query = new URLSearchParams({ country: country.code, status, ...(q ? { q } : {}) });
  if (params.before) query.set('before', params.before);
  const [page, counts] = await Promise.all([
    api<{ checks: Row[]; next: string | null }>(`/admin/id-checks?${query}`),
    api<Record<IdCheckStatus, number>>(`/admin/id-checks/counts?country=${country.code}`),
  ]);
  const link = (changes: Record<string, string | null>) =>
    listLink('/id-checks', { status, q }, changes, { status: 'review' });
  const waiting = status === 'review' || status === 'checking';
  const decided = status === 'verified' || status === 'declined';
  const time = (iso: string) => dateTime(iso, country.timezone);
  return (
    <>
      <PageHeader
        title="Customers' ID checks"
        subtitle={`Customers in ${country.name} check their ID before adding money or requesting errands. When the identity provider's checks don't all pass, the check waits here for a person to decide, longest waiting first. Only the results are kept; the ID and selfie stay with the provider.`}
      />
      <ListControls
        base="/id-checks"
        label="ID check status"
        filters={ORDER.map((s) => ({ value: s, label: `${ID_CHECK_STATUS[s].label} · ${counts[s] ?? 0}` }))}
        current={status}
        link={(s) => link({ status: s, before: null, q: null })}
        q={q}
        searchLabel="Search ID checks"
        placeholder="Name, legal name or phone"
        hidden={status !== 'review' ? { status } : undefined}
      />
      <Card padded={false}>
        {page.checks.length === 0 ? (
          <Empty
            title={
              q
                ? `Nobody matches “${q}”`
                : status === 'review'
                  ? 'Nothing to review'
                  : `No checks ${ID_CHECK_STATUS[status].label.toLowerCase()}`
            }
          >
            {status === 'review' && !q ? 'ID checks that need a person show up here.' : null}
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className={tableClass}>
              <thead className="border-b border-line">
                <tr>
                  <th className={thClass}>Customer</th>
                  <th className={thClass}>ID</th>
                  <th className={thClass}>{decided ? 'Decision' : 'Needs a look'}</th>
                  <th className={thClass}>{decided ? 'Decided' : waiting ? 'Waiting since' : 'Checked'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {page.checks.map((c) => {
                  const since = c.checkedAt ?? c.createdAt;
                  return (
                    <tr key={c.id} className="align-top hover:bg-surface-2/60">
                      <td className={tdClass}>
                        <Link href={`/people/${c.id}#identity`} className="font-bold hover:underline">
                          {nameOf(c)}
                        </Link>
                        <span className="num block text-[13px] text-ink-3">{c.phone}</span>
                        {c.legalName ? (
                          <span className="block text-[13px] text-ink-3">On the ID: {c.legalName}</span>
                        ) : null}
                      </td>
                      <td className={tdClass}>
                        {c.idName}
                        <span className="block text-[13px] text-ink-3">{c.provider}</span>
                      </td>
                      <td className={tdClass}>
                        {decided ? (
                          <span className="block max-w-sm text-sm text-ink-2">{c.decisionNote ?? '—'}</span>
                        ) : c.flagged.length ? (
                          <ul className="flex flex-wrap gap-1.5">
                            {c.flagged.map((f) => (
                              <li key={f.key}>
                                <Badge tone={OUTCOME[f.outcome]?.tone ?? 'warn'}>{f.label}</Badge>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <span className="text-ink-3">—</span>
                        )}
                      </td>
                      <td className={`${tdClass} num whitespace-nowrap text-ink-3`}>
                        {decided && c.decidedAt ? time(c.decidedAt) : time(since)}
                        {waiting ? <span className="block text-[13px]">{waited(since)}</span> : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Pager
        newest={params.before ? link({ before: null }) : null}
        older={page.next ? link({ before: page.next }) : null}
        labels={waiting ? { first: 'Longest waiting', next: 'Next' } : undefined}
      />
    </>
  );
}
