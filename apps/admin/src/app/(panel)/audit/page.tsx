import type { Metadata } from 'next';
import Link from 'next/link';
import { buttonClass, Card, Empty, PageHeader, tableClass, tdClass, thClass } from '@/components/ui';
import { adminRoleLabel } from '@jiffo/shared';
import { api, getCountry, getMe } from '@/lib/api';
import { dateTime } from '@/lib/format';

export const metadata: Metadata = { title: 'Audit log' };

interface Entry {
  id: number;
  action: string;
  targetType: string | null;
  targetId: string | null;
  data: Record<string, unknown>;
  ip: string | null;
  createdAt: string;
  admin: { id: string; name: string; email: string };
}

/** One line a person can read, from the action and what it changed. */
function describe(entry: Entry, names: Map<string, string>): string {
  const who = (entry.targetId && names.get(entry.targetId)) || String(entry.data.email ?? 'a teammate');
  switch (entry.action) {
    case 'team.invite':
      return `Invited ${String(entry.data.email)} as ${adminRoleLabel(String(entry.data.role)).toLowerCase()}`;
    case 'team.reset':
      return `Reset ${who}'s password and authenticator app`;
    case 'team.update': {
      const from = entry.data.from as { role: string; status: string } | undefined;
      const to = entry.data.to as { role: string; status: string } | undefined;
      const changes: string[] = [];
      if (from && to && from.role !== to.role)
        changes.push(
          `changed ${who} from ${adminRoleLabel(from.role).toLowerCase()} to ${adminRoleLabel(to.role).toLowerCase()}`,
        );
      if (from && to && from.status !== to.status)
        changes.push(to.status === 'disabled' ? `disabled ${who}` : `enabled ${who}`);
      const line = changes.join(' and ') || `updated ${who}`;
      return line[0]!.toUpperCase() + line.slice(1);
    }
    default:
      return entry.action;
  }
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ before?: string }> }) {
  const me = await getMe();
  if (!me.permissions.includes('team')) {
    return (
      <Card>
        <Empty title="Only owners can read the audit log" />
      </Card>
    );
  }
  const before = Number((await searchParams).before);
  const query = Number.isInteger(before) && before > 0 ? `?before=${before}` : '';
  const [log, team, country] = await Promise.all([
    api<{ entries: Entry[]; more: boolean }>(`/admin/audit${query}`),
    api<Array<{ id: string; name: string }>>('/admin/team'),
    getCountry(),
  ]);
  const names = new Map(team.map((t) => [t.id, t.name]));
  const last = log.entries.at(-1);

  return (
    <>
      <PageHeader
        title="Audit log"
        subtitle="Every change made in the admin panel, newest first. Nothing here can be edited."
      />
      <Card padded={false}>
        {log.entries.length === 0 ? (
          <Empty title={query ? 'No older entries' : 'Nothing has been changed yet'} />
        ) : (
          <div className="overflow-x-auto">
            <table className={tableClass}>
              <thead className="border-b border-line">
                <tr>
                  <th className={thClass}>When</th>
                  <th className={thClass}>Who</th>
                  <th className={thClass}>What</th>
                  <th className={thClass}>From</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {log.entries.map((e) => (
                  <tr key={e.id}>
                    <td className={`${tdClass} num whitespace-nowrap text-ink-3`}>
                      {dateTime(e.createdAt, country.timezone)}
                    </td>
                    <td className={tdClass}>
                      <div className="font-semibold">{e.admin.name}</div>
                      <div className="text-[13px] text-ink-3">{e.admin.email}</div>
                    </td>
                    <td className={tdClass}>{describe(e, names)}</td>
                    <td className={`${tdClass} num text-ink-3`}>{e.ip ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <div className="mt-4 flex gap-2">
        {query ? (
          <Link href="/audit" className={buttonClass('secondary', true)}>
            Newest
          </Link>
        ) : null}
        {log.more && last ? (
          <Link href={`/audit?before=${last.id}`} className={buttonClass('secondary', true)}>
            Older entries
          </Link>
        ) : null}
      </div>
    </>
  );
}
