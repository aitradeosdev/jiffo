import type { ReactNode } from 'react';
import { Wordmark } from './wordmark';

/** The narrow centred frame for sign-in and invite pages. */
export function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-dvh items-start justify-center px-4 py-12 sm:items-center">
      <div className="w-full max-w-[420px]">
        <div className="mb-8 flex items-center gap-2.5">
          <Wordmark height={30} />
          <span className="rounded-md bg-ink px-1.5 py-0.5 text-xs font-bold tracking-wide text-on-ink uppercase">
            Admin
          </span>
        </div>
        <div className="rounded-2xl border border-line bg-surface p-6 sm:p-8">{children}</div>
      </div>
    </main>
  );
}
