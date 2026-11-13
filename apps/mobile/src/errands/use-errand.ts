import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect, useIsFocused } from 'expo-router';
import type { ErrandEvent } from '@jiffo/shared';
import { useSession } from '@/auth/session';
import { ApiError, errorMessage } from '@/api/client';
import { useResource } from '@/api/useResource';
import { useErrandSubscription, useRealtimeEvent } from '@/realtime/realtime';
import type { ErrandView } from './types';

/**
 * One errand, kept live, with its actions. Shared by the customer's tracker and chat so both show the
 * same state and refusals.
 */
export function useErrand(id: string | undefined) {
  const { api } = useSession();
  const { data: errand, error, reload, setData } = useResource<ErrandView>(id ? `/v1/errands/${id}` : null);
  const [busy, setBusy] = useState<ErrandEvent | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  /** How much a refused fee raise was short by, to offer a top-up. */
  const [shortKobo, setShortKobo] = useState<number | null>(null);
  useErrandSubscription(id);
  // The tracker stays mounted under the chat. Only the screen in front fetches; one behind notes that it
  // missed an update and catches up when it comes back to the front.
  const focused = useIsFocused();
  const missed = useRef(false);
  const hasPhotos = !!errand?.photos && (errand.photos.items.length > 0 || !!errand.photos.dropoff);
  const photosShown = useRef(hasPhotos);
  photosShown.current = hasPhotos;
  // The same update arrives on the errand's room and the user's own room: reload once per new version.
  useRealtimeEvent<{ errandId: string; version: number }>('errand.updated', (u) => {
    if (u.errandId !== id || (errand && u.version <= errand.version)) return;
    if (focused) reload();
    else missed.current = true;
  });
  // Coming back (from a top-up or the chat, say), an old refusal no longer applies.
  useFocusEffect(
    useCallback(() => {
      setActionError(null);
      setShortKobo(null);
      // Also refresh photo links, which may have expired while another screen was in front.
      if (missed.current || photosShown.current) {
        missed.current = false;
        reload();
      }
    }, [reload]),
  );
  // Photo links expire after 15 minutes: refresh every 10 while there are photos on screen.
  useEffect(() => {
    if (!hasPhotos || !focused) return;
    const timer = setInterval(reload, 10 * 60_000);
    return () => clearInterval(timer);
  }, [hasPhotos, focused, reload]);

  const can = (event: ErrandEvent) => !!errand?.allowedEvents.includes(event);

  /** Sends an event; true when it went through. */
  const act = async (event: ErrandEvent, data?: Record<string, unknown>) => {
    if (!errand) return false;
    setBusy(event);
    setActionError(null);
    setShortKobo(null);
    try {
      setData(await api.post<ErrandView>(`/v1/errands/${errand.id}/events`, { event, version: errand.version, data }));
      return true;
    } catch (e) {
      setActionError(errorMessage(e));
      if (e instanceof ApiError && e.code === 'insufficient_funds') {
        setShortKobo(Number(e.details.neededKobo ?? 0) - Number(e.details.balanceKobo ?? 0));
      }
      reload();
      return false;
    } finally {
      setBusy(null);
    }
  };

  return { errand, error, reload, can, act, busy, actionError, shortKobo };
}

/** The customer's hand-off PIN, which exists only once the agent marks the errand delivered. */
export function useHandoffPin(errand: ErrandView | null) {
  const { api } = useSession();
  const [pin, setPin] = useState<string | null>(null);
  const id = errand?.id;
  const delivered = errand?.status === 'delivered' && errand.role === 'customer';
  useEffect(() => {
    if (!delivered || !id) return setPin(null);
    api
      .get<{ pin: string }>(`/v1/errands/${id}/pin`)
      .then((r) => setPin(r.pin))
      .catch(() => setPin(null));
  }, [api, id, delivered]);
  return pin;
}
