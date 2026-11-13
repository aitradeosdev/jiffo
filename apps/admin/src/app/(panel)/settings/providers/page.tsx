import type { Metadata } from 'next';
import { PROVIDERS, type ProviderCategory } from '@jiffo/shared';
import { Badge, Card, Empty, Notice } from '@/components/ui';
import { api, getMe } from '@/lib/api';
import { ProviderCard, SwitchOff, type ProviderView } from './forms';

export const metadata: Metadata = { title: 'Providers' };

interface Category {
  category: ProviderCategory;
  label: string;
  about: string;
  active: string | null;
  fallback: string;
  providers: ProviderView[];
}

const STAND_INS = new Set(['console', 'memory', 'fake']);
const DONE: Record<string, string> = {
  saved: 'Saved. Test it before switching it on.',
  on: 'Switched on. New requests use it now; things already started finish where they began.',
  off: "Switched off. The server's own setting is used now.",
  removed: 'Removed, with its keys.',
};

/** What a category uses while no provider is switched on. */
function fallbackLabel(fallback: string, live: boolean) {
  if (fallback === 'none' || (live && STAND_INS.has(fallback))) return 'nothing: it is not set up';
  if (STAND_INS.has(fallback)) return 'the development stand-in';
  const name = PROVIDERS.find((p) => p.key === fallback)?.name ?? fallback;
  return `${name}, from the server's environment`;
}

/**
 * The outside services Jiffo uses and the provider for each. Keys are typed here, stored encrypted, and
 * never shown again. Owners only.
 */
export default async function ProvidersPage({
  searchParams,
}: {
  searchParams: Promise<{ done?: string; p?: string }>;
}) {
  const me = await getMe();
  if (!me.permissions.includes('settings')) {
    return (
      <Card>
        <Empty title="Only owners can see and change providers" />
      </Card>
    );
  }
  const params = await searchParams;
  const data = await api<{ live: boolean; categories: Category[] }>('/admin/providers');
  const done = DONE[params.done ?? ''];

  return (
    <div className="space-y-6">
      <p className="text-sm text-ink-3">
        Choose a provider for each service, enter the keys from your account with them, test, then switch on. Keys are
        stored encrypted and never shown again, only their last characters. A change takes effect within 30 seconds,
        without a restart.
      </p>
      {data.categories.map((c) => {
        const active = c.providers.find((p) => p.active);
        const notSet = !active && (c.fallback === 'none' || (data.live && STAND_INS.has(c.fallback)));
        return (
          <section key={c.category} id={c.category} className="scroll-mt-6">
            <Card
              title={c.label}
              action={
                active ? (
                  <Badge tone="brand">Using {active.name}</Badge>
                ) : notSet ? (
                  <Badge tone="danger">Not set up</Badge>
                ) : (
                  <Badge>{STAND_INS.has(c.fallback) ? 'Development stand-in' : 'Set by the server'}</Badge>
                )
              }
            >
              <p className="text-sm text-ink-3">{c.about}</p>
              {params.p === `${c.category}:` && done ? (
                <div className="mt-3">
                  <Notice tone="brand">{done}</Notice>
                </div>
              ) : null}
              {!active ? (
                <p className="mt-1 text-sm text-ink-2">
                  Until one is switched on, this uses {fallbackLabel(c.fallback, data.live)}.
                </p>
              ) : null}
              <div className="mt-4 space-y-4">
                {c.providers.length === 0 ? (
                  <p className="text-sm text-ink-3">No providers for this yet.</p>
                ) : (
                  c.providers.map((p) => (
                    <ProviderCard
                      key={`${p.key}-${p.updatedAt ?? 'new'}`}
                      category={c.category}
                      provider={p}
                      canEdit
                      updated={params.p === `${c.category}:${p.key}` ? (done ?? null) : null}
                    />
                  ))
                )}
                {active ? <SwitchOff category={c.category} fallback={fallbackLabel(c.fallback, data.live)} /> : null}
              </div>
            </Card>
          </section>
        );
      })}
    </div>
  );
}
