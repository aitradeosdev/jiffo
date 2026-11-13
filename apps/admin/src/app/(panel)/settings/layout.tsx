import type { ReactNode } from 'react';
import { PageHeader } from '@/components/ui';
import { getCountry, getMe } from '@/lib/api';
import { SettingsTabs } from './tabs';

export default async function SettingsLayout({ children }: { children: ReactNode }) {
  const [country, me] = await Promise.all([getCountry(), getMe()]);
  return (
    <>
      <PageHeader
        title="Settings"
        subtitle={
          me.permissions.includes('settings')
            ? `How Jiffo runs in ${country.name}. Changes apply to new errands; ones already running keep their settings.`
            : `How Jiffo runs in ${country.name}. Only owners can change these.`
        }
      />
      <SettingsTabs />
      {children}
    </>
  );
}
