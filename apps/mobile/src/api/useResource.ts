import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { useSession } from '../auth/session';
import { errorMessage } from './client';

/**
 * Loads a GET resource for a screen, reloads it each time the screen comes back into view, and exposes
 * reload() for pull-to-refresh and realtime events. Keeps the last good data while reloading.
 */
export function useResource<T>(path: string | null) {
  const { api } = useSession();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!path);
  const live = useRef(true);

  const reload = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    try {
      const next = await api.get<T>(path);
      if (live.current) {
        setData(next);
        setError(null);
      }
    } catch (e) {
      if (live.current) setError(errorMessage(e));
    } finally {
      if (live.current) setLoading(false);
    }
  }, [api, path]);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  return { data, error, loading, reload, setData };
}
