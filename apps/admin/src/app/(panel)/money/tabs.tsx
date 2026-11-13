'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/money', label: 'Overview' },
  { href: '/money/top-ups', label: 'Top-ups' },
  { href: '/money/withdrawals', label: 'Withdrawals' },
  { href: '/money/checks', label: 'Nightly checks' },
];

export function MoneyTabs() {
  const path = usePathname();
  return (
    <nav aria-label="Money" className="mb-5 flex flex-wrap gap-1.5">
      {TABS.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={path === t.href ? 'page' : undefined}
          className={`h-9 rounded-full px-3.5 text-sm leading-9 font-semibold ${
            path === t.href ? 'bg-ink text-on-ink' : 'bg-surface text-ink-2 hover:bg-surface-2'
          }`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
