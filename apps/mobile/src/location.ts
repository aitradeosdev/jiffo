import { useCallback, useEffect, useState } from 'react';
import * as Location from 'expo-location';

export interface Coords {
  lat: number;
  lng: number;
}

/**
 * The phone's location, asked for once when needed. The board uses it to show nearby errands; it is
 * not tracked in the background.
 */
export function useCurrentLocation() {
  const [coords, setCoords] = useState<Coords | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        setError('Allow location to see errands near you.');
        return;
      }
      const last = await Location.getLastKnownPositionAsync().catch(() => null);
      if (last) setCoords({ lat: last.coords.latitude, lng: last.coords.longitude });
      const now = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setCoords({ lat: now.coords.latitude, lng: now.coords.longitude });
      setError(null);
    } catch {
      setError("Couldn't get your location. Check that location is on.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { coords, error, loading, refresh };
}
