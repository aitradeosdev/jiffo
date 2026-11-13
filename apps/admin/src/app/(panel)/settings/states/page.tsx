import type { Metadata } from 'next';
import { Card } from '@/components/ui';
import { api, getCountry, getMe } from '@/lib/api';
import { StateRow, type State } from './forms';

export const metadata: Metadata = { title: 'States' };

export default async function StatesPage() {
  const [me, country] = await Promise.all([getMe(), getCountry()]);
  const states = await api<State[]>(`/admin/states?country=${country.code}`);
  const open = states.filter((s) => s.enabled).length;
  return (
    <Card title={`${open} of ${states.length} states open for errands`}>
      <p className="-mt-1 text-sm text-ink-3">
        Customers can request errands only in open states. The agent sign-up setting is saved and sent to the apps now;
        the agent app starts acting on it when agent verification launches.
      </p>
      <div className="divide-y divide-line">
        {states.map((s) => (
          <StateRow
            key={`${s.id}-${s.enabled}-${s.agentSignups}`}
            state={s}
            canEdit={me.permissions.includes('settings')}
          />
        ))}
      </div>
    </Card>
  );
}
