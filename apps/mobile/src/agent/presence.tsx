import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Linking } from 'react-native';
import * as Location from 'expo-location';
import { useSession } from '../auth/session';
import { errorMessage } from '../api/client';
import type { Coords } from '../location';

/** How often a moving agent's position is sent at most. */
const REPORT_EVERY_MS = 10_000;

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
  /** An errand screen holds this while the agent is out on the errand, so the customer can follow them. */
  holdForErrand: () => () => void;
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
  const [holds, setHolds] = useState(0);
  const lastSent = useRef(0);
  const onlineRef = useRef(online);
  onlineRef.current = online;

  useEffect(() => {
    api
      .get<{ online: boolean }>('/v1/agent/presence')
      .then((r) => setOnlineState(r.online))
      .catch(() => undefined);
  }, [api]);

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
  const tracking = online || holds > 0;
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
    return () => {
      stopped = true;
      watch?.remove();
    };
  }, [tracking, send]);

  const holdForErrand = useCallback(() => {
    setHolds((n) => n + 1);
    return () => setHolds((n) => n - 1);
  }, []);

  const value = useMemo<Presence>(
    () => ({
      online,
      coords,
      switching,
      error,
      blocked,
      setOnline,
      openSettings: () => Linking.openSettings(),
      holdForErrand,
    }),
    [online, coords, switching, error, blocked, setOnline, holdForErrand],
  );
  return <PresenceContext.Provider value={value}>{children}</PresenceContext.Provider>;
}

export function usePresence() {
  const value = useContext(PresenceContext);
  if (!value) throw new Error('usePresence must be used inside AgentPresenceProvider');
  return value;
}

/** Keeps the agent's position flowing to the customer while this errand needs it. */
export function useShareLocationDuring(active: boolean) {
  const { holdForErrand } = usePresence();
  useEffect(() => (active ? holdForErrand() : undefined), [active, holdForErrand]);
}
