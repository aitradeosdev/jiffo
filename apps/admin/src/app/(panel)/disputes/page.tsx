import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge, buttonClass, Card, Empty, PageHeader } from '@/components/ui';
import { api, getCountry } from '@/lib/api';
import { EVENT, getCategories, nameOf, type PersonRef } from '@/lib/errands';
import { money, waited } from '@/lib/format';

export const metadata: Metadata = { title: 'Disputes' };

interface Dispute {
  id: string;
  description: string;
  categoryKey: string;
  buy: boolean;
  feeKobo: number;
  serviceFeeKobo: number;
  itemAmountKobo: number | null;
  customer: PersonRef;
  agent: PersonRef | null;
  since: string;
  openedBy: string | null;
  cause: string | null;
  reason: string | null;
}

const OPENED_BY: Record<string, string> = {
  customer: 'The customer',
  agent: 'The agent',
  system: 'Jiffo, automatically',
  admin: 'Support',
};

export default async function DisputesPage() {
  const country = await getCountry();
  const [{ disputes }, categories] = await Promise.all([
    api<{ disputes: Dispute[] }>(`/admin/disputes?country=${country.code}`),
    getCategories(country.code),
  ]);
  const naira = (kobo: number) => money(kobo, country.currency);

  return (
    <>
      <PageHeader
        title="Disputes"
        subtitle="Errands waiting for support to decide, the one waiting longest first. The money stays held until then."
      />
      {disputes.length === 0 ? (
        <Card>
          <Empty title="No disputes right now">New ones appear here as soon as they are opened.</Empty>
        </Card>
      ) : (
        <ul className="space-y-3">
          {disputes.map((d) => (
            <li key={d.id}>
              <Card>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone="danger">Waiting {waited(d.since)}</Badge>
                      <span className="text-[13px] text-ink-3">
                        {categories.get(d.categoryKey) ?? d.categoryKey}
                        {d.buy ? ' · buys items' : ''}
                      </span>
                    </div>
                    <h2 className="mt-2 line-clamp-2 text-[17px] font-bold">{d.description}</h2>
                    <p className="mt-1 text-[15px] text-ink-2">
                      <span className="font-semibold">
                        {OPENED_BY[d.openedBy ?? ''] ?? 'Someone'}: {EVENT[d.cause ?? ''] ?? 'dispute opened'}
                      </span>
                      {d.reason ? <> · “{d.reason}”</> : null}
                    </p>
                    <p className="mt-2 text-[13px] text-ink-3">
                      Customer {nameOf(d.customer)} · Agent {nameOf(d.agent)} · Fee {naira(d.feeKobo)}
                      {d.itemAmountKobo ? ` · Items ${naira(d.itemAmountKobo)}` : ''}
                    </p>
                  </div>
                  <Link href={`/errands/${d.id}`} className={buttonClass('primary', true)}>
                    Review
                  </Link>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
