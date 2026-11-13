import { useCallback, useState } from 'react';
import { Linking } from 'react-native';
import * as Location from 'expo-location';

export interface Coords {
  lat: number;
  lng: number;
}

/**
 * The phone's location, read when asked (the board asks each time it refreshes). Not tracked in the
 * background. When permission was refused for good, `blocked` says so, and openSettings sends the
 * person to the system setting, since asking again would do nothing.
 */
export function useCurrentLocation() {
  const [coords, setCoords] = useState<Coords | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);

  const locate = useCallback(async (): Promise<Coords | null> => {
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        setBlocked(!permission.canAskAgain);
        setError(
          permission.canAskAgain
            ? 'Allow location to see errands near you.'
            : 'Location is off for Jiffo Agent. Turn it on in Settings to see errands near you.',
        );
        return null;
      }
      setBlocked(false);
      const position =
        (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(() => null)) ??
        (await Location.getLastKnownPositionAsync().catch(() => null));
      if (!position) {
        setError("Couldn't get your location. Check that location is on.");
        return null;
      }
      const next = { lat: position.coords.latitude, lng: position.coords.longitude };
      setCoords(next);
      setError(null);
      return next;
    } catch {
      setError("Couldn't get your location. Check that location is on.");
      return null;
    }
  }, []);

  /** The location only if it is already allowed: never shows the permission prompt. */
  const peek = useCallback(async (): Promise<Coords | null> => {
    try {
      const permission = await Location.getForegroundPermissionsAsync();
      if (!permission.granted) return null;
      const position =
        (await Location.getLastKnownPositionAsync().catch(() => null)) ??
        (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(() => null));
      if (!position) return null;
      const next = { lat: position.coords.latitude, lng: position.coords.longitude };
      setCoords(next);
      return next;
    } catch {
      return null;
    }
  }, []);

  return { coords, error, blocked, locate, peek, openSettings: () => Linking.openSettings() };
}
