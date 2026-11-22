import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { goBack } from '@/nav';
import { useSession } from '@/auth/session';
import { errorMessage } from '@/api/client';
import { destinationNote, type DestinationStatus } from '@/agent/destination';
import { usePlaceSearch, type Suggestion } from '@/places/use-place-search';
import { Button, Field, Screen, Text } from '@/ui/kit';
import { Row } from '@/ui/parts';

/**
 * Destination mode (docs/matching.md, M13): the agent picks where they are heading, such as home, and sees only
 * errands that take them closer until they get there or clear it, a few times a day.
 */
export default function DestinationScreen() {
  const { api } = useSession();
  const [status, setStatus] = useState<DestinationStatus | null>(null);
  const { query, setQuery, results, busy, error, setError, place } = usePlaceSearch();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .get<DestinationStatus>('/v1/agent/destination')
      .then(setStatus)
      .catch((e) => setError(errorMessage(e)));
  }, [api, setError]);

  const choose = async (s: Suggestion) => {
    // A double tap must not set it twice, using two of the day's.
    if (saving) return;
    setSaving(true);
    try {
      const picked = await place(s);
      await api.put<DestinationStatus>('/v1/agent/destination', {
        lat: picked.lat,
        lng: picked.lng,
        label: picked.name,
      });
      goBack();
    } catch (e) {
      setError(errorMessage(e));
      setSaving(false);
    }
  };
  const clear = async () => {
    setSaving(true);
    try {
      setStatus(await api.delete<DestinationStatus>('/v1/agent/destination'));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const canSet = !!status?.enabled && status.usesLeft > 0;
  return (
    <Screen>
      <Text variant="heading">Heading somewhere?</Text>
      {status ? <Text tone="ink2">{destinationNote(status)}</Text> : <ActivityIndicator />}
      {status?.destination ? (
        <View style={{ gap: 8 }}>
          <Row icon="flag" title={status.destination.label} subtitle="Where you're heading" />
          <Button kind="secondary" label="Clear destination" onPress={() => void clear()} loading={saving} />
        </View>
      ) : null}
      {canSet ? (
        <>
          <Field
            label={status?.destination ? 'Or head somewhere else' : 'Search for a place or address'}
            value={query}
            onChangeText={setQuery}
            error={error}
            returnKeyType="search"
          />
          {busy || saving ? <ActivityIndicator /> : null}
          <View>
            {results.map((r) => (
              <Row key={r.placeId} icon="map-pin" title={r.title} subtitle={r.subtitle} onPress={() => choose(r)} />
            ))}
            {!busy && query.trim().length >= 2 && results.length === 0 && !error ? (
              <Text tone="ink3">No places match. Try the street or area name.</Text>
            ) : null}
          </View>
        </>
      ) : error ? (
        <Text tone="danger">{error}</Text>
      ) : null}
    </Screen>
  );
}
