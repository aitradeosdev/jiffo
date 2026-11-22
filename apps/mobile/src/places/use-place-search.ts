import { useEffect, useMemo, useRef, useState } from 'react';
import * as Crypto from 'expo-crypto';
import { useSession } from '@/auth/session';
import { errorMessage } from '@/api/client';
import type { PlacePick } from '@/errands/types';

export interface Suggestion {
  placeId: string;
  title: string;
  subtitle: string;
}

/**
 * Address search, as the place screens use it: suggestions for what is typed, a moment after typing stops, and the
 * place for the one picked. A search session token groups the typing and the pick for billing.
 */
export function usePlaceSearch() {
  const { api } = useSession();
  const session = useMemo(() => Crypto.randomUUID(), []);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Suggestion[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef('');

  useEffect(() => {
    const q = query.trim();
    latest.current = q;
    if (q.length < 2) {
      setResults([]);
      setBusy(false);
      return;
    }
    const timer = setTimeout(async () => {
      setBusy(true);
      try {
        const found = await api.get<Suggestion[]>(
          `/v1/places/autocomplete?q=${encodeURIComponent(q)}&session=${session}`,
        );
        if (latest.current === q) {
          setResults(found);
          setError(null);
        }
      } catch (e) {
        if (latest.current === q) setError(errorMessage(e));
      } finally {
        // Only the latest search clears the spinner; a newer one (or a short query) manages its own.
        if (latest.current === q) setBusy(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query, api, session]);

  /** The place for a suggestion picked. */
  const place = (s: Suggestion) => api.get<PlacePick>(`/v1/places/${encodeURIComponent(s.placeId)}?session=${session}`);

  return { query, setQuery, results, busy, error, setError, place };
}
