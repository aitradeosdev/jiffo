import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge, Card, Empty, PageHeader } from '@/components/ui';
import { api, getCountry } from '@/lib/api';
import { nameOf, type PersonRef } from '@/lib/errands';
import { dateTime, money } from '@/lib/format';

export const metadata: Metadata = { title: 'Drop-offs' };

interface Dropoff {
  id: string;
  description: string;
  feeKobo: number;
  itemAmountKobo: number | null;
  dueAt: string | null;
  pausedAt: string | null;
  sentAt: string | null;
  photoUrl: string | null;
  customer: PersonRef;
  agent: PersonRef | null;
}

/** "in 5 h 20 min", or "now" once it is due. */
function inTime(iso: string) {
  const minutes = Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 60_000));
  if (minutes === 0) return 'now';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `in ${h ? `${h} h ` : ''}${m} min`.trim();
}

/**
 * Drop-off photos waiting for the customer's approval (docs/security-plan.md, X2), each with its timer: the
 * soonest to be approved by itself first, then those staff paused. Open one to pause its timer, step in
 * (which freezes the money for a dispute), or decide.
 */
export default async function DropoffsPage() {
  const country = await getCountry();
  const { dropoffs } = await api<{ dropoffs: Dropoff[] }>(`/admin/dropoffs?country=${country.code}`);
  const time = (iso: string) => dateTime(iso, country.timezone);
  const naira = (kobo: number) => money(kobo, country.currency);

  return (
    <>
      <PageHeader
        title="Drop-offs"
        subtitle="Drop-off photos waiting for the customer to approve them. Each is approved by itself when its timer ends, and the agent is paid. Open one to pause its timer, step in, or decide."
      />
      <Card padded={false}>
        {dropoffs.length === 0 ? (
          <Empty title="No drop-off photos waiting" />
        ) : (
          <ul className="divide-y divide-line">
            {dropoffs.map((d) => (
              <li key={d.id} className="flex gap-4 px-5 py-4">
                {d.photoUrl ? (
                  <a href={d.photoUrl} target="_blank" rel="noreferrer" className="shrink-0">
                    <img src={d.photoUrl} alt="Drop-off photo" className="h-20 w-20 rounded-lg object-cover" />
                  </a>
                ) : (
                  <div className="h-20 w-20 shrink-0 rounded-lg bg-surface-2" aria-hidden />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {d.pausedAt ? (
                      <Badge tone="warn">Paused since {time(d.pausedAt)}</Badge>
                    ) : d.dueAt ? (
                      <Badge tone="neutral">
                        Approved {inTime(d.dueAt)} · {time(d.dueAt)}
                      </Badge>
                    ) : null}
                    {d.sentAt ? <span className="text-[13px] text-ink-3">Photo sent {time(d.sentAt)}</span> : null}
                  </div>
                  <Link href={`/errands/${d.id}`} className="mt-1 block font-bold underline">
                    {d.description.length > 90 ? `${d.description.slice(0, 90)}…` : d.description}
                  </Link>
                  <p className="mt-1 text-sm text-ink-2">
                    Customer {nameOf(d.customer)}
                    {d.agent ? ` · Agent ${nameOf(d.agent)}` : ''} · fee {naira(d.feeKobo)}
                    {d.itemAmountKobo ? ` · items ${naira(d.itemAmountKobo)}` : ''}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
