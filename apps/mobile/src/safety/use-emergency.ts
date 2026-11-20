import { useCallback } from 'react';
import { Linking } from 'react-native';
import * as Location from 'expo-location';
import { useCountryConfig } from '../api/useCountryConfig';
import type { ApiClient } from '../api/client';
import { useSession } from '../auth/session';
import { emergencyNumberOf, pressEmergency, type EmergencyDeps, type Spot } from './emergency';

const FIX_WAIT_MS = 10_000;

/** Where the phone is now, asking for permission if it hasn't been asked; null when it can't say. */
async function locate(): Promise<Spot | null> {
  let permission = await Location.getForegroundPermissionsAsync();
  if (!permission.granted && permission.canAskAgain) permission = await Location.requestForegroundPermissionsAsync();
  if (!permission.granted) return null;
  const fix = await Promise.race([
    Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), FIX_WAIT_MS)),
  ]);
  if (!fix) return null;
  const { latitude, longitude, accuracy } = fix.coords;
  return { lat: latitude, lng: longitude, ...(typeof accuracy === 'number' ? { accuracy } : {}) };
}

const phoneDeps = (api: ApiClient): EmergencyDeps => ({
  dial: (number) => void Linking.openURL(`tel:${number}`).catch(() => undefined),
  locate,
  report: (body) => api.post<{ id: string }>('/v1/safety/emergencies', body),
  follow: async (id, spot) => {
    await api.post(`/v1/safety/emergencies/${encodeURIComponent(id)}/positions`, spot);
  },
  every: (ms, run) => {
    const timer = setInterval(run, ms);
    return () => clearInterval(timer);
  },
});

/** The emergency button's number and what pressing it does (docs/security-plan.md, E9). */
export function useEmergency() {
  const { api } = useSession();
  const { config } = useCountryConfig();
  const number = emergencyNumberOf(config?.settings);
  const press = useCallback(
    (errandId?: string) => void pressEmergency(phoneDeps(api), { number, ...(errandId ? { errandId } : {}) }),
    [api, number],
  );
  return { number, press };
}
