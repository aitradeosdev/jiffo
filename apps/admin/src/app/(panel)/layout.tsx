import type { ReactNode } from 'react';
import { AuditIcon, OverviewIcon, SignOutIcon, TeamIcon } from '@/components/icons';
import { Wordmark } from '@/components/wordmark';
import { getCountry, getMe, type Permission } from '@/lib/api';
import { chooseCountry, signOut } from './actions';
import { CountrySelect, Nav, type NavItem } from './nav';

const ROLE: Record<string, string> = {
  owner: 'Owner',
  operations: 'Operations',
  finance: 'Finance',
  support: 'Support',
};

const SECTIONS: Array<NavItem & { needs: Permission }> = [
  { href: '/', label: 'Overview', icon: <OverviewIcon />, needs: 'read' },
  { href: '/team', label: 'Team', icon: <TeamIcon />, needs: 'team' },
  { href: '/audit', label: 'Audit log', icon: <AuditIcon />, needs: 'team' },
];

/** Every signed-in page: the sections on the left (on top on small screens), the page on the right. */
export default async function PanelLayout({ children }: { children: ReactNode }) {
  const [me, country] = await Promise.all([getMe(), getCountry()]);
  const items = SECTIONS.filter((s) => me.permissions.includes(s.needs)).map(({ needs: _, ...item }) => item);

  return (
    <div className="lg:flex">
      <aside className="border-b border-line bg-surface lg:sticky lg:top-0 lg:flex lg:h-dvh lg:w-64 lg:shrink-0 lg:flex-col lg:border-r lg:border-b-0">
        <div className="flex items-center justify-between gap-3 px-4 pt-4 pb-3 lg:px-5 lg:pt-6 lg:pb-5">
          <div className="flex items-center gap-2">
            <Wordmark height={24} />
            <span className="rounded-md bg-ink px-1.5 py-0.5 text-[11px] font-bold tracking-wide text-on-ink uppercase">
              Admin
            </span>
          </div>
          <form action={signOut} className="lg:hidden">
            <button
              type="submit"
              className="flex h-9 items-center gap-1.5 rounded-full px-3 text-sm font-semibold text-ink-2 hover:bg-surface-2"
            >
              <SignOutIcon />
              Sign out
            </button>
          </form>
        </div>
        <div className="px-3 pb-3 lg:flex-1 lg:px-3">
          <Nav items={items} />
        </div>
        <div className="hidden border-t border-line p-4 lg:block">
          {me.countries.length > 1 ? (
            <div className="mb-3">
              <CountrySelect countries={me.countries} current={country.code} action={chooseCountry} />
            </div>
          ) : (
            <p className="mb-3 text-[13px] font-semibold text-ink-3">{country.name}</p>
          )}
          <p className="truncate text-sm font-bold">{me.name}</p>
          <p className="truncate text-[13px] text-ink-3">
            {ROLE[me.role] ?? me.role} · {me.email}
          </p>
          <form action={signOut} className="mt-3">
            <button
              type="submit"
              className="flex h-9 w-full items-center gap-2 rounded-xl px-2 text-sm font-semibold text-ink-2 hover:bg-surface-2"
            >
              <SignOutIcon />
              Sign out
            </button>
          </form>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-10">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
