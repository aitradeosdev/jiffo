'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/settings', label: 'Prices and rules' },
  { href: '/settings/categories', label: 'Categories' },
  { href: '/settings/states', label: 'States' },
  { href: '/settings/places', label: 'Places' },
  { href: '/settings/providers', label: 'Providers' },
];

/**
 * Places opens as a page of its own: its security rules, which let Google's map load, come with its document, so
 * reached within the panel it would keep the stricter rules of the page before, and the map wouldn't load.
 */
export const fullLoad = (href: string) => href === '/settings/places';

export function SettingsTabs() {
  const path = usePathname();
  return (
    <nav aria-label="Settings" className="mb-5 flex flex-wrap gap-1.5">
      {TABS.map((t) => {
        const props = {
          'aria-current': path === t.href ? ('page' as const) : undefined,
          className: `h-9 rounded-full px-3.5 text-sm leading-9 font-semibold ${
            path === t.href ? 'bg-ink text-on-ink' : 'bg-surface text-ink-2 hover:bg-surface-2'
          }`,
        };
        return fullLoad(t.href) ? (
          <a key={t.href} href={t.href} {...props}>
            {t.label}
          </a>
        ) : (
          <Link key={t.href} href={t.href} {...props}>
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
