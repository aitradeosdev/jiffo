import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Linking } from 'react-native';
import * as Location from 'expo-location';
import { useSession } from '../auth/session';
import { useRealtimeEvent } from '../realtime/realtime';
import { errorMessage } from '../api/client';
import type { Coords } from '../location';

/** How often a moving agent's position is sent at most. */
const REPORT_EVERY_MS = 10_000;
/** Sent this often even when the agent isn't moving, so a parked agent stays visible and online. */
const HEARTBEAT_MS = 60_000;

interface Presence {
  /** Taking errands now. */
  online: boolean;
  /** The last known position, while online or on an errand. */
  coords: Coords | null;
  switching: boolean;
  error: string | null;
  /** Location is off for the app for good; only Settings can turn it back on. */
  blocked: boolean;
  setOnline: (online: boolean) => Promise<void>;
  openSettings: () => void;
  /** The agent has an errand running, so their position keeps flowing to that customer. */
  onErrand: boolean;
}

const PresenceContext = createContext<Presence | null>(null);

/**
 * The agent going online and offline, and their position while online or on an errand. Location is read
 * only while the app is open (foreground); nothing is tracked once the agent is offline and free.
 */
export function AgentPresenceProvider({ children }: { children: ReactNode }) {
  const { api } = useSession();
  const [online, setOnlineState] = useState(false);
  const [coords, setCoords] = useState<Coords | null>(null);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [onErrand, setOnErrand] = useState(false);
  const lastSent = useRef(0);
  const onlineRef = useRef(online);
  onlineRef.current = online;
  const coordsRef = useRef(coords);
  coordsRef.current = coords;
  /** Set once the agent switches; a slower first read must not undo it. */
  const switched = useRef(false);

  // Where things stood when the app opened, and whenever one of the agent's errands changes.
  const refresh = useCallback(async () => {
    try {
      const r = await api.get<{ online: boolean; onErrand: boolean }>('/v1/agent/presence');
      setOnErrand(r.onErrand);
      return r;
    } catch {
      return null;
    }
  }, [api]);
  useEffect(() => {
    (async () => {
      const r = await refresh();
      if (!r?.online || switched.current) return;
      // Back online after a restart: carry on only if location still works, else say why and go offline.
      const permission = await Location.getForegroundPermissionsAsync().catch(() => null);
      const position = permission?.granted
        ? await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(() => null)
        : null;
      if (switched.current) return;
      if (!position) {
        setBlocked(!!permission && !permission.granted && !permission.canAskAgain);
        setError("You're offline because Jiffo Agent can't read your location. Go online again when it's on.");
        await api.put('/v1/agent/presence', { online: false }).catch(() => undefined);
        return;
      }
      const here = { lat: position.coords.latitude, lng: position.coords.longitude };
      setCoords(here);
      setOnlineState(true);
    })();
  }, [api, refresh]);
  useRealtimeEvent('errand.updated', () => {
    void refresh();
  });

  const permit = useCallback(async () => {
    const permission = await Location.requestForegroundPermissionsAsync();
    setBlocked(!permission.granted && !permission.canAskAgain);
    if (!permission.granted) {
      setError(
        permission.canAskAgain
          ? 'Allow location to go online. Customers see where you are only during their errand.'
          : 'Location is off for Jiffo Agent. Turn it on in Settings to go online.',
      );
      return false;
    }
    return true;
  }, []);

  const send = useCallback(
    async (next: { online: boolean; lat?: number; lng?: number }) => {
      lastSent.current = Date.now();
      await api.put('/v1/agent/presence', next);
    },
    [api],
  );

  const setOnline = useCallback(
    async (next: boolean) => {
      switched.current = true;
      setSwitching(true);
      setError(null);
      try {
        if (next) {
          if (!(await permit())) return;
          const position =
            (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(() => null)) ??
            (await Location.getLastKnownPositionAsync().catch(() => null));
          if (!position) {
            setError("Couldn't get your location. Check that location is on, then try again.");
            return;
          }
          const here = { lat: position.coords.latitude, lng: position.coords.longitude };
          setCoords(here);
          await send({ online: true, ...here });
        } else {
          await send({ online: false });
        }
        setOnlineState(next);
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        setSwitching(false);
      }
    },
    [permit, send],
  );

  // Follow the agent while online or out on an errand, sending at most every few seconds.
  const tracking = online || onErrand;
  useEffect(() => {
    if (!tracking) return;
    let watch: Location.LocationSubscription | null = null;
    let stopped = false;
    (async () => {
      const permission = await Location.getForegroundPermissionsAsync();
      if (!permission.granted || stopped) return;
      watch = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, timeInterval: REPORT_EVERY_MS, distanceInterval: 25 },
        (position) => {
          const here = { lat: position.coords.latitude, lng: position.coords.longitude };
          setCoords(here);
          if (Date.now() - lastSent.current < REPORT_EVERY_MS) return;
          send({ online: onlineRef.current, ...here }).catch(() => undefined);
        },
      );
      if (stopped) watch.remove();
    })();
    // A phone that isn't moving sends nothing above, so send the last position every minute too.
    const heartbeat = setInterval(() => {
      const here = coordsRef.current;
      if (here && Date.now() - lastSent.current >= HEARTBEAT_MS) {
        send({ online: onlineRef.current, ...here }).catch(() => undefined);
      }
    }, HEARTBEAT_MS / 4);
    return () => {
      stopped = true;
      watch?.remove();
      clearInterval(heartbeat);
    };
  }, [tracking, send]);

  const value = useMemo<Presence>(
    () => ({
      online,
      coords,
      switching,
      error,
      blocked,
      setOnline,
      openSettings: () => Linking.openSettings(),
      onErrand,
    }),
    [online, coords, switching, error, blocked, setOnline, onErrand],
  );
  return <PresenceContext.Provider value={value}>{children}</PresenceContext.Provider>;
}

export function usePresence() {
  const value = useContext(PresenceContext);
  if (!value) throw new Error('usePresence must be used inside AgentPresenceProvider');
  return value;
}
