import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import type { PlacePick } from './types';

export type StopField = 'pickup' | 'stop' | 'dropoff';

export interface Draft {
  categoryKey: string | null;
  description: string;
  /** null until the customer touches the switch: the category's default applies. */
  buy: boolean | null;
  urgent: boolean;
  pickup: PlacePick | null;
  stop: PlacePick | null;
  dropoff: PlacePick | null;
  /** Chosen on the review screen; null means the suggested fee. */
  feeKobo: number | null;
}

const EMPTY: Draft = {
  categoryKey: null,
  description: '',
  buy: null,
  urgent: false,
  pickup: null,
  stop: null,
  dropoff: null,
  feeKobo: null,
};

const DraftContext = createContext<{
  draft: Draft;
  update: (changes: Partial<Draft>) => void;
  reset: () => void;
} | null>(null);

/** The errand being written, shared by the plan, place search and review screens. */
export function DraftProvider({ children }: { children: ReactNode }) {
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const value = useMemo(
    () => ({
      draft,
      update: (changes: Partial<Draft>) => setDraft((d) => ({ ...d, ...changes })),
      reset: () => setDraft(EMPTY),
    }),
    [draft],
  );
  return <DraftContext.Provider value={value}>{children}</DraftContext.Provider>;
}

export function useDraft() {
  const value = useContext(DraftContext);
  if (!value) throw new Error('useDraft must be used inside DraftProvider');
  return value;
}

/** The stops in order, for the quote and the request. */
export const draftStops = (d: Draft) =>
  [
    d.pickup && { ...d.pickup, kind: 'pickup' as const },
    d.stop && { ...d.stop, kind: 'stop' as const },
    d.dropoff && { ...d.dropoff, kind: 'dropoff' as const },
  ].filter((s): s is PlacePick & { kind: 'pickup' | 'stop' | 'dropoff' } => !!s);
