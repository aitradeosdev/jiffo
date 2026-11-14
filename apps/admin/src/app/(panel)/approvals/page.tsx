import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge, Card, Empty, Notice } from '@/components/ui';
import { api, getCountry } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { CancelForm, DecideForms } from './forms';

export const metadata: Metadata = { title: 'Approvals' };

interface Approval {
  id: string;
  label: string;
  status: string;
  summary: string;
  note: string;
  requestedBy: { id: string; name: string | null };
  decidedBy: { id: string; name: string | null } | null;
  selfApproved: boolean;
  decisionNote: string | null;
  error: string | null;
  createdAt: string;
  decidedAt: string | null;
  expiresAt: string;
  canDecide: boolean;
  canCancel: boolean;
}

const DONE: Record<string, string> = {
  asked:
    'Asked. It happens once another admin whose role allows it approves it here. You can take it back while it waits.',
  approved: 'Approved. It has run, and the audit log shows you both.',
  rejected: 'Turned down. Nothing changed.',
  cancelled: 'Taken back. Nothing changed.',
};

const STATUS: Record<string, { label: string; tone: 'neutral' | 'brand' | 'danger' | 'warn' }> = {
  pending: { label: 'Waiting', tone: 'warn' },
  running: { label: 'Running', tone: 'neutral' },
  approved: { label: 'Approved', tone: 'brand' },
  rejected: { label: 'Turned down', tone: 'neutral' },
  cancelled: { label: 'Taken back', tone: 'neutral' },
  failed: { label: "Couldn't run", tone: 'danger' },
  expired: { label: 'Lapsed', tone: 'neutral' },
};

/**
 * Changes that wait for a second admin (docs/security-plan.md, D4): wallet adjustments, big dispute
 * splits, settings, team changes, suspending busy agents and provider changes. Nobody approves their own.
 */
export default async function ApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<{ done?: string; show?: string }>;
}) {
  const params = await searchParams;
  const decided = params.show === 'decided';
  const [data, country] = await Promise.all([
    api<{ approvals: Approval[] }>(`/admin/approvals?done=${decided ? 'true' : 'false'}`),
    getCountry(),
  ]);
  const time = (iso: string) => dateTime(iso, country.timezone);
  const done = DONE[params.done ?? ''];

  return (
    <div className="space-y-6">
      <p className="text-sm text-ink-3">
        Wallet adjustments, big dispute splits, settings, team changes, suspending busy agents and provider changes each
        need a second admin whose role allows them. Nobody can approve their own. When no one else could approve a
        change, it goes ahead at once and is marked so.
      </p>
      <div className="flex gap-2">
        <Link
          href="/approvals"
          aria-current={!decided ? 'page' : undefined}
          className={`rounded-full px-3.5 py-1.5 text-sm font-semibold ${!decided ? 'bg-ink text-on-ink' : 'bg-surface-2 text-ink-2'}`}
        >
          Waiting
        </Link>
        <Link
          href="/approvals?show=decided"
          aria-current={decided ? 'page' : undefined}
          className={`rounded-full px-3.5 py-1.5 text-sm font-semibold ${decided ? 'bg-ink text-on-ink' : 'bg-surface-2 text-ink-2'}`}
        >
          Decided
        </Link>
      </div>
      {done ? <Notice tone="brand">{done}</Notice> : null}
      {data.approvals.length === 0 ? (
        <Card>
          <Empty title={decided ? 'Nothing decided yet' : 'Nothing waiting'} />
        </Card>
      ) : (
        data.approvals.map((a) => {
          const status = STATUS[a.status] ?? { label: a.status, tone: 'neutral' as const };
          return (
            <Card key={a.id} title={a.label} action={<Badge tone={status.tone}>{status.label}</Badge>}>
              <p className="text-[15px] font-semibold">{a.summary}</p>
              <p className="mt-1 text-sm text-ink-2">
                Asked by {a.requestedBy.name ?? 'a former teammate'} · {time(a.createdAt)} · “{a.note}”
              </p>
              {a.status === 'pending' ? (
                <p className="mt-1 text-[13px] text-ink-3">Lapses {time(a.expiresAt)} unless decided.</p>
              ) : null}
              {a.decidedBy && a.status !== 'pending' ? (
                <p className="mt-1 text-sm text-ink-2">
                  {a.selfApproved
                    ? 'Went ahead without a second admin: nobody else could approve it.'
                    : `${status.label} by ${a.decidedBy.name ?? 'a former teammate'}${a.decidedAt ? ` · ${time(a.decidedAt)}` : ''}`}
                  {a.decisionNote && !a.selfApproved ? ` · “${a.decisionNote}”` : ''}
                </p>
              ) : null}
              {a.error ? <p className="mt-1 text-sm text-danger">{a.error}</p> : null}
              {a.canDecide ? <DecideForms id={a.id} /> : null}
              {a.canCancel ? <CancelForm id={a.id} /> : null}
            </Card>
          );
        })
      )}
    </div>
  );
}
