import type { Metadata } from 'next';
import Link from 'next/link';
import { ListControls, Pager } from '@/components/list-controls';
import { Badge, Card, Empty, PageHeader, tableClass, tdClass, thClass } from '@/components/ui';
import { api, getCountry } from '@/lib/api';
import { APPLICATION_STATUS, OUTCOME, type ApplicationStatus, type Check } from '@/lib/applications';
import { nameOf } from '@/lib/errands';
import { dateTime } from '@/lib/format';
import { listLink } from '@/lib/links';

export const metadata: Metadata = { title: 'Applications' };

const ORDER: ApplicationStatus[] = ['review', 'checking', 'draft', 'approved', 'rejected'];

interface Row {
  id: string;
  firstName: string | null;
  lastName: string | null;
  phone: string;
  legalName: string | null;
  stateName: string | null;
  area: string | null;
  status: ApplicationStatus;
  flagged: Check[];
  submittedAt: string | null;
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

/** Agent applications by state; the ones in review are support's queue. */
export default async function ApplicationsPage({
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
    api<{ applications: Row[]; next: string | null }>(`/admin/applications?${query}`),
    api<Record<ApplicationStatus, number>>(`/admin/applications/counts?country=${country.code}`),
  ]);
  const link = (changes: Record<string, string | null>) =>
    listLink('/applications', { status, q }, changes, { status: 'review' });
  const waiting = status === 'review' || status === 'checking';
  const decided = status === 'approved' || status === 'rejected';
  const time = (iso: string) => dateTime(iso, country.timezone);

  return (
    <>
      <PageHeader
        title="Agent applications"
        subtitle={`Agents in ${country.name} apply before they can take errands. When the identity provider's checks don't all pass, the application waits here for a person to decide, longest waiting first. Only the results are kept; the documents stay with the provider.`}
      />
      <ListControls
        base="/applications"
        label="Application status"
        filters={ORDER.map((s) => ({ value: s, label: `${APPLICATION_STATUS[s].label} · ${counts[s] ?? 0}` }))}
        current={status}
        link={(s) => link({ status: s, before: null, q: null })}
        q={q}
        searchLabel="Search applications"
        placeholder="Name, legal name or phone"
        hidden={status !== 'review' ? { status } : undefined}
      />
      <Card padded={false}>
        {page.applications.length === 0 ? (
          <Empty
            title={
              q
                ? `Nobody matches “${q}”`
                : status === 'review'
                  ? 'Nothing to review'
                  : `No applications ${APPLICATION_STATUS[status].label.toLowerCase()}`
            }
          >
            {status === 'review' && !q ? 'Applications whose checks need a person show up here.' : null}
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className={tableClass}>
              <thead className="border-b border-line">
                <tr>
                  <th className={thClass}>Agent</th>
                  <th className={thClass}>Where</th>
                  <th className={thClass}>{decided ? 'Decision' : 'Needs a look'}</th>
                  <th className={thClass}>{decided ? 'Decided' : waiting ? 'Waiting since' : 'Started'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {page.applications.map((a) => {
                  const since = a.submittedAt ?? a.createdAt;
                  return (
                    <tr key={a.id} className="align-top hover:bg-surface-2/60">
                      <td className={tdClass}>
                        <Link href={`/people/${a.id}#application`} className="font-bold hover:underline">
                          {nameOf(a)}
                        </Link>
                        <span className="num block text-[13px] text-ink-3">{a.phone}</span>
                        {a.legalName ? (
                          <span className="block text-[13px] text-ink-3">On the NIN: {a.legalName}</span>
                        ) : null}
                      </td>
                      <td className={tdClass}>
                        {a.stateName ? (
                          <>
                            {a.stateName}
                            <span className="block text-[13px] text-ink-3">{a.area}</span>
                          </>
                        ) : (
                          <span className="text-ink-3">Not chosen</span>
                        )}
                      </td>
                      <td className={tdClass}>
                        {decided ? (
                          <span className="block max-w-sm text-sm text-ink-2">{a.decisionNote ?? '—'}</span>
                        ) : a.flagged.length ? (
                          <ul className="flex flex-wrap gap-1.5">
                            {a.flagged.map((c) => (
                              <li key={c.key}>
                                <Badge tone={OUTCOME[c.outcome]?.tone ?? 'warn'}>{c.label}</Badge>
                              </li>
                            ))}
                          </ul>
                        ) : status === 'review' && a.decisionNote ? (
                          // An agent from before applications: no checks were run, and the note says so.
                          <span className="block max-w-sm text-sm text-ink-2">{a.decisionNote}</span>
                        ) : (
                          <span className="text-ink-3">—</span>
                        )}
                      </td>
                      <td className={`${tdClass} num whitespace-nowrap text-ink-3`}>
                        {decided && a.decidedAt ? time(a.decidedAt) : time(since)}
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
