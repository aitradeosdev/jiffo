import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { useSession } from '../auth/session';
import { errorMessage } from './client';

/**
 * Loads a GET resource for a screen and reloads it each time the screen comes back into view. Keeps the
 * last good data while reloading. `refresh` is for pull-to-refresh (its spinner shows only then);
 * `reloadSoon` is for live events, so a burst of them costs one request.
 */
export function useResource<T>(path: string | null) {
  const { api } = useSession();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!path);
  const [refreshing, setRefreshing] = useState(false);
  const live = useRef(true);
  const soon = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

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

  const reloadSoon = useCallback(() => {
    clearTimeout(soon.current);
    soon.current = setTimeout(() => reload(), 150);
  }, [reload]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await reload();
    if (live.current) setRefreshing(false);
  }, [reload]);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      clearTimeout(soon.current);
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  return { data, error, loading, refreshing, reload, reloadSoon, refresh, setData };
}
