import type { Metadata } from 'next';
import Link from 'next/link';
import { Pager } from '@/components/list-controls';
import { Badge, Card, Empty, Notice, PageHeader, tableClass, tdClass, thClass } from '@/components/ui';
import {
  adminRoleLabel,
  agentTierLabel,
  isProviderCategory,
  PROVIDER_CATEGORY_INFO,
  providerInfo,
} from '@jiffo/shared';
import { formatNaira, STAFF_ALERT_LABELS, type StaffAlertKind } from '@jiffo/shared';
import { api, getCountry, getMe } from '@/lib/api';
import { ResolveStaffAlertForm } from './staff-alerts';
import { dateTime, money } from '@/lib/format';
import { FIELD_BY_PATH } from '@/lib/settings-fields';
import { PRICE_LABELS, type PriceField } from '@/lib/prices';

export const metadata: Metadata = { title: 'Audit log' };

interface Entry {
  id: number;
  action: string;
  targetType: string | null;
  targetId: string | null;
  targetLabel: string | null;
  countryCode: string | null;
  data: Record<string, unknown>;
  /** Why, as the admin gave it. */
  reason: string | null;
  /** The panel, or the command line on a server. */
  via: 'panel' | 'cli';
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  /** None for the command line. */
  admin: { id: string; name: string; email: string } | null;
}

/** A browser's name, short enough for the log: "Chrome on macOS" rather than the whole user agent. */
function browserOf(ua: string | null) {
  if (!ua) return null;
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Firefox\//.test(ua)
      ? 'Firefox'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Safari\//.test(ua)
          ? 'Safari'
          : 'Another browser';
  const system = /Windows/.test(ua)
    ? 'Windows'
    : /Android/.test(ua)
      ? 'Android'
      : /iPhone|iPad/.test(ua)
        ? 'iOS'
        : /Mac OS X/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : null;
  return system ? `${browser} on ${system}` : browser;
}

/** One line a person can read, from the action and what it changed. */
function describe(entry: Entry, names: Map<string, string>, currencyOf: (code: string | null) => string): string {
  const who = (entry.targetId && names.get(entry.targetId)) || String(entry.data.email ?? 'a teammate');
  switch (entry.action) {
    case 'team.invite':
      return `Invited ${String(entry.data.email)} as ${adminRoleLabel(String(entry.data.role)).toLowerCase()}`;
    case 'approval.request':
      return `Asked a second admin to approve: ${String(entry.data.summary ?? '')}`;
    case 'approval.approve':
      return entry.data.selfApproved
        ? `Went ahead without a second admin (nobody else could approve): ${String(entry.data.summary ?? '')}`
        : `Approved: ${String(entry.data.summary ?? '')}`;
    case 'approval.reject':
      return `Turned down: ${String(entry.data.summary ?? '')}`;
    case 'approval.cancel':
      return `Took back their request: ${String(entry.data.summary ?? '')}`;
    case 'person.reveal':
      return `Revealed ${who}'s personal details`;
    case 'team.invite_withdrawn':
      return `Took back the invite for ${who}: the email couldn't be sent`;
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
    case 'prices.change': {
      const changes = (entry.data.changes as Array<{ field: string; to: number | null }>) ?? [];
      return `Changed the prices for ${String(entry.data.place)}: ${
        changes
          .map((c) => {
            const info = PRICE_LABELS[c.field as PriceField];
            if (!info) return c.field;
            return `${info.label.toLowerCase()} ${c.to === null ? 'as above' : info.percent ? `${c.to / 100}%` : formatNaira(c.to)}`;
          })
          .join(', ') || 'nothing'
      }`;
    }
    case 'city.create':
      return `Drew the city ${String(entry.data.name)} in ${String(entry.data.state)} (${String(entry.data.km2)} km²)`;
    case 'area.create':
      return `Drew the area ${String(entry.data.name)} in ${String(entry.data.city)} (${String(entry.data.km2)} km²)`;
    case 'city.update':
    case 'area.update': {
      const changes = (entry.data.changes as Array<{ field: string; to: unknown }>) ?? [];
      const what = changes
        .map((c) =>
          c.field === 'enabled'
            ? c.to
              ? 'switched on'
              : 'switched off'
            : c.field === 'name'
              ? `renamed ${String(c.to)}`
              : `reshaped (${String(c.to)})`,
        )
        .join(', ');
      return `Changed the ${entry.action === 'city.update' ? 'city' : 'area'} ${String(entry.data.name)}: ${what || 'nothing'}`;
    }
    case 'person.suspend':
      return `Suspended ${entry.targetLabel ?? 'an account'}`;
    case 'person.reactivate':
      return `Reactivated ${entry.targetLabel ?? 'an account'}`;
    case 'provider.save': {
      const info = providerInfo(String(entry.data.category), String(entry.data.provider));
      const fields = ((entry.data.changed as string[] | undefined) ?? []).map(
        (k) => info?.fields.find((f) => f.key === k)?.label ?? k,
      );
      return `Saved ${String(entry.data.name)} settings${fields.length ? `: ${fields.join(', ')}` : ''}`;
    }
    case 'provider.activate': {
      const category = String(entry.data.category);
      const label = isProviderCategory(category) ? PROVIDER_CATEGORY_INFO[category].label : category;
      const to = entry.data.to ? (providerInfo(category, String(entry.data.to))?.name ?? String(entry.data.to)) : null;
      return to ? `Switched ${label} to ${to}` : `Switched ${label} back to the server's own setting`;
    }
    case 'provider.callback':
      return `Made a new callback address for ${String(entry.data.name)}`;
    case 'provider.remove':
      return `Removed ${String(entry.data.name)} settings and keys`;
    case 'application.approve':
      return `Approved ${entry.targetLabel ?? 'an agent'}'s application`;
    case 'application.reject':
      return `Declined ${entry.targetLabel ?? 'an agent'}'s application`;
    case 'application.reopen':
      return `Reopened ${entry.targetLabel ?? 'an agent'}'s application for them to send again`;
    case 'errand.admin_cancel':
      return `Cancelled “${entry.targetLabel ?? 'an errand'}” before an agent took it`;
    case 'errand.admin_intervene':
      return `Stepped into “${entry.targetLabel ?? 'an errand'}”`;
    case 'errand.pause_release':
      return `Paused the automatic approval of “${entry.targetLabel ?? 'an errand'}”'s drop-off photo`;
    case 'errand.resume_release':
      return `Started the automatic approval of “${entry.targetLabel ?? 'an errand'}”'s drop-off photo again`;
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

interface StaffAlert {
  id: string;
  kind: string;
  message: string;
  createdAt: string;
  resolvedAt: string | null;
  resolveNote: string | null;
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ before?: string; done?: string }>;
}) {
  const me = await getMe();
  if (!me.permissions.includes('team')) {
    return (
      <Card>
        <Empty title="Only owners can read the audit log" />
      </Card>
    );
  }
  const params = await searchParams;
  const before = Number(params.before);
  const query = Number.isInteger(before) && before > 0 ? `?before=${before}` : '';
  const [log, team, [country, staff]] = await Promise.all([
    api<{ entries: Entry[]; more: boolean }>(`/admin/audit${query}`),
    api<Array<{ id: string; name: string }>>('/admin/team'),
    getCountry().then(
      async (c) => [c, await api<{ alerts: StaffAlert[] }>(`/admin/staff-alerts?country=${c.code}`)] as const,
    ),
  ]);
  const openStaff = staff.alerts.filter((a) => !a.resolvedAt);
  const names = new Map(team.map((t) => [t.id, t.name]));
  const currencyOf = (code: string | null) => me.countries.find((c) => c.code === code)?.currency ?? country.currency;
  const last = log.entries.at(-1);

  return (
    <>
      <PageHeader
        title="Audit log"
        subtitle="Every change made in the admin panel or with the server's command line, newest first, with why and from where. Nothing here can be changed or deleted."
      />
      {params.done ? (
        <div className="mb-4">
          <Notice tone="brand">Alert closed.</Notice>
        </div>
      ) : null}
      <Card title="Alerts about staff" padded={false}>
        {openStaff.length === 0 ? (
          <Empty title="No open alerts about staff" />
        ) : (
          <ul className="divide-y divide-line">
            {openStaff.map((a) => (
              <li key={a.id} className="px-5 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="warn">{STAFF_ALERT_LABELS[a.kind as StaffAlertKind] ?? a.kind}</Badge>
                  <span className="text-[13px] text-ink-3">{dateTime(a.createdAt, country.timezone)}</span>
                </div>
                <p className="mt-1 text-sm">{a.message}</p>
                <ResolveStaffAlertForm id={a.id} />
              </li>
            ))}
          </ul>
        )}
      </Card>
      <div className="h-6" />
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
                      {e.admin ? (
                        <>
                          <div className="font-semibold">{e.admin.name}</div>
                          <div className="text-[13px] text-ink-3">{e.admin.email}</div>
                        </>
                      ) : (
                        <div className="font-semibold">Server command line</div>
                      )}
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
                      {e.reason || typeof e.data.note === 'string' ? (
                        <span className="block text-[13px] text-ink-3">“{e.reason ?? String(e.data.note)}”</span>
                      ) : null}
                    </td>
                    <td className={`${tdClass} text-ink-3`}>
                      <div className="num">{e.ip ?? '—'}</div>
                      {browserOf(e.userAgent) ? <div className="text-[13px]">{browserOf(e.userAgent)}</div> : null}
                    </td>
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
