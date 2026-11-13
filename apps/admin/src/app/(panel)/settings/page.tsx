import type { Metadata } from 'next';
import { Card, Notice } from '@/components/ui';
import { api, getCountry, getMe } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { FIELD_BY_PATH, shown } from '@/lib/settings-fields';
import { SettingsForm } from './settings-form';

export const metadata: Metadata = { title: 'Settings' };

interface SettingsView {
  version: number;
  settings: Record<string, unknown>;
  history: Array<{
    version: number;
    createdAt: string;
    createdBy: string | null;
    changes: Array<{ path: string; from: unknown; to: unknown }>;
  }>;
}

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ saved?: string }> }) {
  const saved = Number((await searchParams).saved);
  const [me, country] = await Promise.all([getMe(), getCountry()]);
  const view = await api<SettingsView>(`/admin/settings?country=${country.code}`);
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-4">
        {saved ? <Notice tone="brand">Saved as version {saved}. New errands use it from now on.</Notice> : null}
        {/* A new version starts the form afresh from what is saved. */}
        <SettingsForm
          key={view.version}
          country={country.code}
          version={view.version}
          initial={view.settings}
          canEdit={me.permissions.includes('settings')}
        />
      </div>
      <Card title="Versions" className="self-start">
        <ol className="space-y-4">
          {view.history.map((h) => (
            <li key={h.version}>
              <p className="text-sm font-bold">
                Version {h.version}
                {h.version === view.version ? (
                  <span className="ml-1.5 font-semibold text-brand-ink">· in use</span>
                ) : null}
              </p>
              <p className="text-[13px] text-ink-3">
                {dateTime(h.createdAt, country.timezone)}
                {h.createdBy ? ` · ${h.createdBy}` : ''}
              </p>
              {h.changes.length ? (
                <ul className="num mt-1 space-y-0.5 text-[13px] text-ink-2">
                  {h.changes.map((c) => (
                    <li key={c.path}>
                      {FIELD_BY_PATH.get(c.path)?.label ?? c.path}: {shown(FIELD_BY_PATH.get(c.path), c.from)} →{' '}
                      {shown(FIELD_BY_PATH.get(c.path), c.to)}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}
