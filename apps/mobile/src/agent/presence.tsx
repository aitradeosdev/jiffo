import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState, Linking, View } from 'react-native';
import * as Location from 'expo-location';
import { useSession } from '../auth/session';
import { useRealtimeEvent } from '../realtime/realtime';
import { errorMessage } from '../api/client';
import type { Coords } from '../location';
import { Button, Text } from '../ui/kit';
import { ModalSheet } from '../ui/modal-sheet';
import {
  askForBackground,
  shouldExplainBackground,
  skipBackground,
  startBackgroundLocation,
  stopBackgroundLocation,
} from './background-location';
import { lastSent, markSent, REPORT_EVERY_MS } from './background-rules';

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
 * The agent going online and offline, and their position while online or on an errand. The app sends it
 * while open; with "Allow all the time", the phone keeps sending it in the background too (when the agent
 * switches to their maps app). Nothing is tracked once the agent is offline and free.
 */
export function AgentPresenceProvider({ children }: { children: ReactNode }) {
  const { api, user } = useSession();
  const [online, setOnlineState] = useState(false);
  const [coords, setCoords] = useState<Coords | null>(null);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [onErrand, setOnErrand] = useState(false);
  /** Explaining background location before the phone asks for it. */
  const [explain, setExplain] = useState(false);
  /** The server's answer is in (or the agent switched): until then nothing is started or stopped. */
  const [known, setKnown] = useState(false);
  const onlineRef = useRef(online);
  onlineRef.current = online;
  const coordsRef = useRef(coords);
  coordsRef.current = coords;
  /** Set once the agent switches; a slower first read must not undo it. */
  const switched = useRef(false);

  const send = useCallback(
    async (next: { online: boolean; lat?: number; lng?: number }) => {
      markSent();
      await api.put('/v1/agent/presence', next);
    },
    [api],
  );

  // Where things stood when the app opened, and whenever one of the agent's errands changes.
  const refresh = useCallback(async () => {
    try {
      const r = await api.get<{ online: boolean; onErrand: boolean }>('/v1/agent/presence');
      setOnErrand(r.onErrand);
      setKnown(true);
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
      // Report the position first: the board answers only around a recent one.
      await send({ online: true, ...here }).catch(() => undefined);
      if (switched.current) return;
      setCoords(here);
      setOnlineState(true);
    })();
  }, [api, refresh, send]);
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
        setKnown(true);
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
          if (Date.now() - lastSent() < REPORT_EVERY_MS) return;
          send({ online: onlineRef.current, ...here }).catch(() => undefined);
        },
      );
      if (stopped) watch.remove();
    })();
    // A phone that isn't moving sends nothing above, so send the last position every minute too.
    const heartbeat = setInterval(() => {
      const here = coordsRef.current;
      if (here && Date.now() - lastSent() >= HEARTBEAT_MS) {
        send({ online: onlineRef.current, ...here }).catch(() => undefined);
      }
    }, HEARTBEAT_MS / 4);
    return () => {
      stopped = true;
      watch?.remove();
      clearInterval(heartbeat);
    };
  }, [tracking, send]);

  // In the background, the phone carries on while there is something to share, if the agent allowed it.
  // Nothing changes before the server has said where things stand: a task left running stays running.
  const userId = user?.id;
  const trackingRef = useRef(tracking);
  trackingRef.current = tracking;
  useEffect(() => {
    if (!known) return;
    if (!tracking) {
      stopBackgroundLocation().catch(() => undefined);
      return;
    }
    (async () => {
      // The first time there is something to share: say why the phone is about to ask for "all the time".
      if (userId && AppState.currentState === 'active' && (await shouldExplainBackground(userId))) setExplain(true);
      await startBackgroundLocation();
    })().catch(() => undefined);
  }, [known, tracking, userId]);
  // Back in the app, perhaps after allowing "all the time" in Settings: start if it can now.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && trackingRef.current) startBackgroundLocation().catch(() => undefined);
    });
    return () => sub.remove();
  }, []);
  // Signed out, or no longer on the board: the phone stops too.
  useEffect(
    () => () => {
      stopBackgroundLocation().catch(() => undefined);
    },
    [],
  );

  const answerExplain = async (allow: boolean) => {
    setExplain(false);
    if (!userId) return;
    if (allow && (await askForBackground(userId)) && trackingRef.current) {
      await startBackgroundLocation().catch(() => undefined);
    }
    if (!allow) await skipBackground(userId);
  };

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
  return (
    <PresenceContext.Provider value={value}>
      {children}
      <ModalSheet visible={explain} onClose={() => void answerExplain(false)} label="Location while you use other apps">
        <View style={{ gap: 8 }}>
          <Text variant="heading">Share your location while you use other apps</Text>
          <Text tone="ink2">
            When you&apos;re online or on an errand, Jiffo Agent keeps sharing your location even when the app is closed
            or not in use, for example while you follow directions in your maps app. Customers see it only during their
            errand, and it stops when you go offline with nothing running.
          </Text>
          <Text variant="note" tone="ink3">
            Your phone asks next. Choose &ldquo;Allow all the time&rdquo;. Without it, customers lose track of you when
            you leave the app.
          </Text>
        </View>
        <Button label="Continue" onPress={() => void answerExplain(true)} />
        <Button label="Not now" kind="plain" onPress={() => void answerExplain(false)} />
      </ModalSheet>
    </PresenceContext.Provider>
  );
}

export function usePresence() {
  const value = useContext(PresenceContext);
  if (!value) throw new Error('usePresence must be used inside AgentPresenceProvider');
  return value;
}
