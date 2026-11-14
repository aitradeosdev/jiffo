import type { Metadata } from 'next';
import { connection } from 'next/server';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Jiffo Admin', template: '%s · Jiffo Admin' },
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Every page is drawn per request, never ahead at build time: the content policy (src/proxy.ts) gives each
  // response a fresh nonce, and a page built ahead would carry none, so its scripts would be blocked.
  await connection();
  return (
    <html lang="en-NG">
      <body className="min-h-dvh font-sans">{children}</body>
    </html>
  );
}
