'use client';

import { buttonClass, Card } from '@/components/ui';

/** Anything unexpected while loading a page: say so plainly and offer to try again. */
export default function PanelError({ reset }: { error: Error; reset: () => void }) {
  return (
    <Card>
      <h1 className="text-xl font-extrabold">This page couldn&apos;t load</h1>
      <p className="mt-1 text-ink-3">The API may be busy or unreachable. Nothing you did was lost.</p>
      <button type="button" onClick={reset} className={`${buttonClass('secondary', true)} mt-4`}>
        Try again
      </button>
    </Card>
  );
}
