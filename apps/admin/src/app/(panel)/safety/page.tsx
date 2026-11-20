import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge, Card, Empty, Notice, PageHeader } from '@/components/ui';
import { api, getCountry, getMe } from '@/lib/api';
import { nameOf, type PersonRef } from '@/lib/errands';
import { dateTime } from '@/lib/format';
import { HandleForm } from './handle';

export const metadata: Metadata = { title: 'Safety' };

interface Emergency {
  id: string;
  status: 'open' | 'handled';
  app: 'customer' | 'agent';
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  positions: Array<{ lat: number; lng: number; accuracy: number | null; at: string }>;
  note: string | null;
  createdAt: string;
  handledAt: string | null;
  handledBy: string | null;
  person: PersonRef;
  errand: { id: string; status: string; description: string } | null;
}

const STATUSES = [
  { value: 'open', label: 'Open' },
  { value: 'handled', label: 'Handled' },
] as const;

/** A map at the place, on OpenStreetMap: no tracking, no key needed. */
const mapAt = (lat: number, lng: number) =>
  `https://www.openstreetmap.org/?mlat=${lat.toFixed(6)}&mlon=${lng.toFixed(6)}#map=17/${lat.toFixed(6)}/${lng.toFixed(6)}`;

/**
 * The Safety queue (docs/security-plan.md, E9): emergencies pressed in the apps, the oldest open first. The
 * app has already dialled the emergency number; this is for the safety team to follow up.
 */
export default async function SafetyPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; done?: string }>;
}) {
  const p = await searchParams;
  const status = STATUSES.find((s) => s.value === p.status)?.value ?? 'open';
  const country = await getCountry();
  const [page, counts, me] = await Promise.all([
    api<{ emergencies: Emergency[] }>(`/admin/safety?country=${country.code}&status=${status}`),
    api<{ open: number; handled: number }>(`/admin/safety/counts?country=${country.code}`),
    getMe(),
  ]);
  const canHandle = me.permissions.includes('safety');
  const time = (iso: string) => dateTime(iso, country.timezone);
  const pill = (current: boolean) =>
    `h-9 rounded-full px-3.5 text-sm leading-9 font-semibold ${
      current ? 'bg-ink text-on-ink' : 'bg-surface text-ink-2 hover:bg-surface-2'
    }`;

  return (
    <>
      <PageHeader
        title="Safety"
        subtitle="Emergencies pressed in the apps. The phone has already dialled the emergency number; call the person back, check on the errand, and record what you did."
      />
      {p.done ? (
        <div className="mb-4">
          <Notice tone="brand">Marked handled.</Notice>
        </div>
      ) : null}
      <nav aria-label="Emergency status" className="mb-4 flex flex-wrap gap-1.5">
        {STATUSES.map((s) => (
          <Link
            key={s.value}
            href={s.value === 'open' ? '/safety' : `/safety?status=${s.value}`}
            aria-current={s.value === status ? 'page' : undefined}
            className={pill(s.value === status)}
          >
            {s.label} · {counts[s.value]}
          </Link>
        ))}
      </nav>
      <Card padded={false}>
        {page.emergencies.length === 0 ? (
          <Empty title={status === 'open' ? 'No open emergencies' : 'None handled yet'} />
        ) : (
          <ul className="divide-y divide-line">
            {page.emergencies.map((e) => {
              const last = e.positions.at(-1) ?? (e.lat !== null && e.lng !== null ? { lat: e.lat, lng: e.lng } : null);
              return (
                <li key={e.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/people/${e.person.id}`} className="font-bold underline">
                      {nameOf(e.person)}
                    </Link>
                    <span className="num text-sm text-ink-3">{e.person.phone}</span>
                    <Badge tone={e.status === 'open' ? 'danger' : 'neutral'}>
                      {e.status === 'open' ? 'Open' : 'Handled'}
                    </Badge>
                    <span className="text-[13px] text-ink-3">
                      {e.app === 'agent' ? 'Agent app' : 'Customer app'} · {time(e.createdAt)}
                    </span>
                  </div>
                  {e.errand ? (
                    <p className="mt-1 text-sm">
                      On errand{' '}
                      <Link href={`/errands/${e.errand.id}`} className="underline">
                        {e.errand.description.length > 80
                          ? `${e.errand.description.slice(0, 80)}…`
                          : e.errand.description}
                      </Link>{' '}
                      <span className="text-ink-3">· {e.errand.status}</span>
                    </p>
                  ) : null}
                  <p className="mt-1 text-sm text-ink-2">
                    {last ? (
                      <>
                        <a
                          href={mapAt(last.lat, last.lng)}
                          target="_blank"
                          rel="noreferrer"
                          className="font-semibold underline"
                        >
                          Where they were last
                        </a>
                        {e.positions.length
                          ? ` · ${e.positions.length} positions since, the last at ${time(e.positions.at(-1)!.at)}`
                          : ''}
                      </>
                    ) : (
                      'No location: the phone did not share one.'
                    )}
                  </p>
                  {e.status === 'handled' ? (
                    <p className="mt-2 text-sm text-ink-2">
                      <span className="font-semibold">{e.handledBy ?? 'Someone'}:</span> {e.note}
                      {e.handledAt ? <span className="text-ink-3"> · {time(e.handledAt)}</span> : null}
                    </p>
                  ) : canHandle ? (
                    <HandleForm id={e.id} />
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
