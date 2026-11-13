import type { ReactNode } from 'react';
import { PageHeader } from '@/components/ui';
import { getCountry } from '@/lib/api';
import { MoneyTabs } from './tabs';

export default async function MoneyLayout({ children }: { children: ReactNode }) {
  const country = await getCountry();
  return (
    <>
      <PageHeader title="Money" subtitle={`What Jiffo holds, earns and moves in ${country.name}.`} />
      <MoneyTabs />
      {children}
    </>
  );
}
