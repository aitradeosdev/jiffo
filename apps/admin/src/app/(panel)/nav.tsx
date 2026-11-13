'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

export interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
}

/** The panel's sections. The current one is marked for screen readers as well as drawn darker. */
export function Nav({ items }: { items: NavItem[] }) {
  const path = usePathname();
  return (
    <nav aria-label="Sections" className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
      {items.map((item) => {
        const current = item.href === '/' ? path === '/' : path === item.href || path.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={current ? 'page' : undefined}
            className={`flex h-10 shrink-0 items-center gap-3 rounded-xl px-3 text-[15px] font-semibold transition-colors ${
              current ? 'bg-ink text-on-ink' : 'text-ink-2 hover:bg-surface-2'
            }`}
          >
            {item.icon}
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Switches country as soon as one is picked. */
export function CountrySelect({
  countries,
  current,
  action,
}: {
  countries: Array<{ code: string; name: string }>;
  current: string;
  action: (form: FormData) => Promise<void>;
}) {
  const path = usePathname();
  return (
    <form action={action}>
      <input type="hidden" name="back" value={path} />
      <label className="sr-only" htmlFor="country">
        Country
      </label>
      <select
        id="country"
        name="country"
        defaultValue={current}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="h-9 w-full rounded-lg bg-surface-2 px-2 text-sm font-semibold"
      >
        {countries.map((c) => (
          <option key={c.code} value={c.code}>
            {c.name}
          </option>
        ))}
      </select>
    </form>
  );
}
