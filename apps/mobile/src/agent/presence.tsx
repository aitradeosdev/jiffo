import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState, Linking, View } from 'react-native';
import * as Location from 'expo-location';
import { useSession } from '../auth/session';
import { useRealtimeEvent } from '../realtime/realtime';
import { ApiError, errorMessage } from '../api/client';
import { appCheck } from '../auth/app-check';
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
import { lastSent, markSent, REPORT_EVERY_MS, reported } from './background-rules';
import { offlineMessage } from './offer';
import { selfieNeeded, withSelfie, type SelfieReason } from './selfie';
import { useSelfie } from './selfie-gate';

/** Sent this often even when the agent isn't moving, so a parked agent stays visible and online. */
const HEARTBEAT_MS = 60_000;

/** The server's answer to a report: online or not, and why Jiffo took the agent offline, if it did. */
type PresenceAnswer = { online: boolean; selfieNeeded?: SelfieReason; offlineReason?: string };

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
  const selfie = useSelfie();
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
    async (
      next: {
        online: boolean;
        lat?: number;
        lng?: number;
        mocked?: boolean;
        accuracy?: number;
        fixedAt?: number;
        /** The agent tapped Go online: an agent Jiffo took offline for missed offers is back only so (M6). */
        tapped?: boolean;
      },
      goingOnline = false,
    ) => {
      markSent();
      // Going online carries the app check (MB3), made fresh each time; staying online needs none.
      const checked = goingOnline ? await appCheck('PUT', '/v1/agent/presence', next) : {};
      return api.withHeaders<PresenceAnswer>('PUT', '/v1/agent/presence', next, checked);
    },
    [api],
  );

  // Where things stood when the app opened, and whenever one of the agent's errands changes.
  const refresh = useCallback(async () => {
    try {
      const r = await api.get<{ online: boolean; onErrand: boolean; offlineReason?: string | null }>(
        '/v1/agent/presence',
      );
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
      if (switched.current) return;
      // Taken offline while the app was closed (missed offers, M6): say why.
      if (r && !r.online) setError(offlineMessage(r.offlineReason));
      if (!r?.online) return;
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
      const here = reported(position);
      // Report the position first: the board answers only around a recent one.
      const res = await send({ online: true, ...here }).catch((e: unknown) =>
        selfieNeeded(e) || (e instanceof ApiError && e.code === 'attestation_failed') ? { online: false } : null,
      );
      if (switched.current) return;
      setCoords(here);
      // Taken offline since (the sweep, or support): going online again asks for today's selfie.
      if (res && !res.online) return;
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
          const here = reported(position);
          setCoords(here);
          // Going online the first time each day needs a selfie (docs/security-plan.md, I8). An agent on an
          // errand is kept sharing their position, offline, until it passes.
          const sent = await withSelfie(async () => {
            const res = await send({ online: true, tapped: true, ...here }, true);
            if (res.selfieNeeded) {
              throw new ApiError(403, 'selfie_needed', 'Take your selfie to go online.', { reason: res.selfieNeeded });
            }
            return res;
          }, selfie.take);
          // Not passed: the selfie screen has said why.
          if (!sent) return;
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
    [permit, send, selfie.take],
  );

  /**
   * What the server answered a position sent while online: an agent it had taken offline (the sweep, support,
   * or missed offers) is online again only by going online themselves, so the app shows them offline and why.
   */
  const wentOffline = useCallback((reason?: string | null) => {
    if (!onlineRef.current) return;
    setOnlineState(false);
    setError(offlineMessage(reason) ?? 'You went offline. Go online again to carry on.');
  }, []);
  const followServer = useCallback(
    (res: PresenceAnswer) => {
      if (!res.online) wentOffline(res.offlineReason);
    },
    [wentOffline],
  );
  // Taken offline for missed offers while the app is open: told at once, not at the next report.
  useRealtimeEvent<{ online: boolean; reason?: string }>('presence.updated', (p) => {
    if (!p.online) wentOffline(p.reason);
  });
  const followServerError = useCallback(
    (e: unknown) => {
      // Asked for a selfie, or for the app check (MB3), the server is treating this as going online.
      if (selfieNeeded(e) || (e instanceof ApiError && e.code === 'attestation_failed')) wentOffline();
    },
    [wentOffline],
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
          const here = reported(position);
          setCoords(here);
          if (Date.now() - lastSent() < REPORT_EVERY_MS) return;
          send({ online: onlineRef.current, ...here }).then(followServer, followServerError);
        },
      );
      if (stopped) watch.remove();
    })();
    // A phone that isn't moving sends nothing above, so send the last position every minute too.
    const heartbeat = setInterval(() => {
      const here = coordsRef.current;
      if (here && Date.now() - lastSent() >= HEARTBEAT_MS) {
        send({ online: onlineRef.current, ...here }).then(followServer, followServerError);
      }
    }, HEARTBEAT_MS / 4);
    return () => {
      stopped = true;
      watch?.remove();
      clearInterval(heartbeat);
    };
  }, [tracking, send, followServer, followServerError]);

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
