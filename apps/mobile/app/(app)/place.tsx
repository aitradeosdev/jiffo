import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as Crypto from 'expo-crypto';
import { useSession } from '@/auth/session';
import { errorMessage } from '@/api/client';
import { useDraft, type StopField } from '@/errands/draft';
import type { PlacePick } from '@/errands/types';
import { Field, Screen, Text } from '@/ui/kit';
import { Row } from '@/ui/parts';

interface Suggestion {
  placeId: string;
  title: string;
  subtitle: string;
}

const TITLES: Record<StopField, string> = {
  pickup: 'Pickup location',
  stop: 'Extra stop',
  dropoff: 'Drop-off location',
};

/** Address search for one stop. A search session token groups the typing and the pick for billing. */
export default function PlaceSearch() {
  const { field = 'pickup' } = useLocalSearchParams<{ field: StopField }>();
  const { api } = useSession();
  const { update } = useDraft();
  const session = useMemo(() => Crypto.randomUUID(), []);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Suggestion[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef('');

  useEffect(() => {
    const q = query.trim();
    latest.current = q;
    if (q.length < 2) {
      setResults([]);
      setBusy(false);
      return;
    }
    const timer = setTimeout(async () => {
      setBusy(true);
      try {
        const found = await api.get<Suggestion[]>(
          `/v1/places/autocomplete?q=${encodeURIComponent(q)}&session=${session}`,
        );
        if (latest.current === q) {
          setResults(found);
          setError(null);
        }
      } catch (e) {
        if (latest.current === q) setError(errorMessage(e));
      } finally {
        // Only the latest search clears the spinner; a newer one (or a short query) manages its own.
        if (latest.current === q) setBusy(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query, api, session]);

  const [choosing, setChoosing] = useState(false);
  const choose = async (s: Suggestion) => {
    // A double tap must not fetch twice or close two screens.
    if (choosing) return;
    setChoosing(true);
    try {
      const place = await api.get<PlacePick>(`/v1/places/${encodeURIComponent(s.placeId)}?session=${session}`);
      update({ [field]: place });
      router.back();
    } catch (e) {
      setError(errorMessage(e));
      setChoosing(false);
    }
  };

  return (
    <Screen>
      <Text variant="heading">{TITLES[field]}</Text>
      <Field
        label="Search for a place or address"
        value={query}
        onChangeText={setQuery}
        autoFocus
        error={error}
        returnKeyType="search"
      />
      {busy || choosing ? <ActivityIndicator /> : null}
      <View>
        {results.map((r) => (
          <Row key={r.placeId} icon="map-pin" title={r.title} subtitle={r.subtitle} onPress={() => choose(r)} />
        ))}
        {!busy && query.trim().length >= 2 && results.length === 0 && !error ? (
          <Text tone="ink3">No places match. Try the street or area name.</Text>
        ) : null}
      </View>
    </Screen>
  );
}
