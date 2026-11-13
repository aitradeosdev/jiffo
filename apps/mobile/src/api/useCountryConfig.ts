import { useEffect, useState } from 'react';
import { COUNTRY } from '../config';
import { useSession } from '../auth/session';
import type { CountryConfig } from './types';

/** States, categories and public settings for the country. Fetched once per app start. */
let cached: CountryConfig | null = null;

export function useCountryConfig() {
  const { api } = useSession();
  const [config, setConfig] = useState<CountryConfig | null>(cached);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (cached) return;
    api
      .public<CountryConfig>('GET', `/v1/config/${COUNTRY}`)
      .then((c) => {
        cached = c;
        setConfig(c);
      })
      .catch((e: Error) => setError(e.message));
  }, [api]);
  return { config, error };
}
