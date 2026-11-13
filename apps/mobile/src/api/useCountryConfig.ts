import { useEffect, useState } from 'react';
import { COUNTRY } from '../config';
import { useSession } from '../auth/session';
import type { CountryConfig } from './types';
import { errorMessage } from './client';

/** States, categories and public settings for the country. Fetched once per app start, retried until it arrives. */
let cached: CountryConfig | null = null;

export function useCountryConfig() {
  const { api } = useSession();
  const [config, setConfig] = useState<CountryConfig | null>(cached);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (cached) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    (async () => {
      for (let attempt = 0; !stopped; attempt += 1) {
        try {
          cached = await api.public<CountryConfig>('GET', `/v1/config/${COUNTRY}`);
          if (!stopped) {
            setConfig(cached);
            setError(null);
          }
          return;
        } catch (e) {
          if (stopped) return;
          setError(errorMessage(e));
          await new Promise<void>((resolve) => {
            timer = setTimeout(resolve, Math.min(30_000, 2_000 * 2 ** attempt));
          });
        }
      }
    })();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [api]);
  return { config, error };
}
