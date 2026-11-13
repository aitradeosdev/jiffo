import type { Metadata } from 'next';
import Link from 'next/link';
import { Pager } from '@/components/list-controls';
import { Card, Empty, PageHeader, tableClass, tdClass, thClass } from '@/components/ui';
import { adminRoleLabel, agentTierLabel } from '@jiffo/shared';
import { api, getCountry, getMe } from '@/lib/api';
import { dateTime, money } from '@/lib/format';
import { FIELD_BY_PATH } from '@/lib/settings-fields';

export const metadata: Metadata = { title: 'Audit log' };

interface Entry {
  id: number;
  action: string;
  targetType: string | null;
  targetId: string | null;
  targetLabel: string | null;
  countryCode: string | null;
  data: Record<string, unknown>;
  ip: string | null;
  createdAt: string;
  admin: { id: string; name: string; email: string };
}

/** One line a person can read, from the action and what it changed. */
function describe(entry: Entry, names: Map<string, string>, currencyOf: (code: string | null) => string): string {
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
    case 'agent.tier':
      return `Changed ${entry.targetLabel ?? 'an agent'}'s tier from ${agentTierLabel(String(entry.data.from))} to ${agentTierLabel(
        String(entry.data.to),
      )}`;
    case 'money.adjust':
      return `${entry.data.direction === 'debit' ? 'Took back' : 'Added'} ${money(Number(entry.data.amountKobo ?? 0), currencyOf(entry.countryCode))} ${
        entry.data.direction === 'debit' ? 'from' : 'to'
      } ${entry.targetLabel ?? 'an account'}'s ${entry.data.account === 'agent_available' ? 'agent balance' : 'wallet'}`;
    case 'settings.save': {
      const changes = (entry.data.changes as Array<{ path: string }> | undefined) ?? [];
      return `Saved settings version ${String(entry.data.version)}: ${changes
        .map((c) => FIELD_BY_PATH.get(c.path)?.label ?? c.path)
        .join(', ')}`;
    }
    case 'category.create':
      return `Added the category “${String(entry.data.name)}”`;
    case 'category.update':
      return `Changed the category “${String(entry.data.name)}”`;
    case 'category.delete':
      return `Removed the category “${String(entry.data.name)}”`;
    case 'state.update':
      return `Changed ${String(entry.data.name)}: ${((entry.data.changes as Array<{ path: string; to: unknown }>) ?? [])
        .map((c) =>
          c.path === 'enabled' ? (c.to ? 'errands open' : 'errands closed') : `agent sign-ups ${String(c.to)}`,
        )
        .join(', ')}`;
    case 'person.suspend':
      return `Suspended ${entry.targetLabel ?? 'an account'}`;
    case 'person.reactivate':
      return `Reactivated ${entry.targetLabel ?? 'an account'}`;
    case 'application.approve':
      return `Approved ${entry.targetLabel ?? 'an agent'}'s application`;
    case 'application.reject':
      return `Declined ${entry.targetLabel ?? 'an agent'}'s application`;
    case 'errand.admin_cancel':
      return `Cancelled “${entry.targetLabel ?? 'an errand'}” before an agent took it`;
    case 'errand.admin_intervene':
      return `Stepped into “${entry.targetLabel ?? 'an errand'}”`;
    case 'errand.redeliver':
      return `Arranged a redelivery of “${entry.targetLabel ?? 'an errand'}”`;
    case 'errand.resolve_complete':
    case 'errand.resolve_cancel':
      return `Settled “${entry.targetLabel ?? 'an errand'}” as ${entry.action.endsWith('complete') ? 'complete' : 'cancelled'}${
        entry.data.split ? ', splitting the money' : ''
      }`;
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
  const currencyOf = (code: string | null) => me.countries.find((c) => c.code === code)?.currency ?? country.currency;
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
                    <td className={tdClass}>
                      {e.targetId && (e.targetType === 'person' || e.targetType === 'errand') ? (
                        <Link
                          href={`/${e.targetType === 'person' ? 'people' : 'errands'}/${e.targetId}`}
                          className="hover:underline"
                        >
                          {describe(e, names, currencyOf)}
                        </Link>
                      ) : (
                        describe(e, names, currencyOf)
                      )}
                      {typeof e.data.note === 'string' ? (
                        <span className="block text-[13px] text-ink-3">“{e.data.note}”</span>
                      ) : null}
                    </td>
                    <td className={`${tdClass} num text-ink-3`}>{e.ip ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Pager newest={query ? '/audit' : null} older={log.more && last ? `/audit?before=${last.id}` : null} />
    </>
  );
}
