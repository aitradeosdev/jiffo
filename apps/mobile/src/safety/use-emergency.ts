import { useCallback } from 'react';
import { Alert, Linking } from 'react-native';
import * as Location from 'expo-location';
import { useCountryConfig } from '../api/useCountryConfig';
import type { ApiClient } from '../api/client';
import { useSession } from '../auth/session';
import { emergencyNumberOf, pressEmergency, type EmergencyDeps, type Spot } from './emergency';

/** However long the phone takes, the app stops waiting for a position after this: there is a next tick. */
const FIX_WAIT_MS = 10_000;

const within = <T>(ms: number, work: Promise<T>) =>
  Promise.race([work, new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))]);

/**
 * Where the phone is now; null when it can't say in time. Asks for permission only when `ask`, and the
 * whole of it (a prompt the person can't answer while on the call included) is bounded by FIX_WAIT_MS.
 */
const locate = (ask: boolean): Promise<Spot | null> =>
  within(
    FIX_WAIT_MS,
    (async () => {
      let permission = await Location.getForegroundPermissionsAsync();
      if (!permission.granted && ask && permission.canAskAgain) {
        permission = await Location.requestForegroundPermissionsAsync();
      }
      if (!permission.granted) return null;
      const fix = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const { latitude, longitude, accuracy } = fix.coords;
      return { lat: latitude, lng: longitude, ...(typeof accuracy === 'number' ? { accuracy } : {}) };
    })(),
  ).catch(() => null);

const phoneDeps = (api: ApiClient, number: string): EmergencyDeps => ({
  dial: (n) => void Linking.openURL(`tel:${n}`).catch(() => undefined),
  locate,
  report: (body) => api.post<{ id: string }>('/v1/safety/emergencies', body),
  follow: async (id, spot) => {
    await api.post(`/v1/safety/emergencies/${encodeURIComponent(id)}/positions`, spot);
  },
  every: (ms, run) => {
    const timer = setInterval(run, ms);
    return () => clearInterval(timer);
  },
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  unreached: () =>
    Alert.alert(
      "Jiffo couldn't be reached",
      `Your call to ${number} was placed, but Jiffo's safety team didn't get where you are. Tell the emergency service where you are.`,
    ),
});

/** The emergency button's number and what pressing it does (docs/security-plan.md, E9). */
export function useEmergency() {
  const { api } = useSession();
  const { config } = useCountryConfig();
  const number = emergencyNumberOf(config?.settings);
  const press = useCallback(
    (errandId?: string) => void pressEmergency(phoneDeps(api, number), { number, ...(errandId ? { errandId } : {}) }),
    [api, number],
  );
  return { number, press };
}
