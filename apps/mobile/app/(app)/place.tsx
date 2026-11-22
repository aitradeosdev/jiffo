import { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { oneOf } from '@/links';
import { goBack } from '@/nav';
import { errorMessage } from '@/api/client';
import { STOP_FIELDS, useDraft, type StopField } from '@/errands/draft';
import { usePlaceSearch, type Suggestion } from '@/places/use-place-search';
import { Field, Screen, Text } from '@/ui/kit';
import { Row } from '@/ui/parts';

const TITLES: Record<StopField, string> = {
  pickup: 'Pickup location',
  stop: 'Extra stop',
  dropoff: 'Drop-off location',
};

/** Address search for one stop. A search session token groups the typing and the pick for billing. */
export default function PlaceSearch() {
  const field = oneOf(useLocalSearchParams<{ field?: string }>().field, STOP_FIELDS, 'pickup');
  const { update } = useDraft();
  const { query, setQuery, results, busy, error, setError, place: placeOf } = usePlaceSearch();

  const [choosing, setChoosing] = useState(false);
  const choose = async (s: Suggestion) => {
    // A double tap must not fetch twice or close two screens.
    if (choosing) return;
    setChoosing(true);
    try {
      const place = await placeOf(s);
      // Outside the areas where Jiffo works: said here, rather than when the errand is sent.
      if (!place.stateCode) {
        setError(`Jiffo doesn't work at ${place.name} yet. Pick a place where Jiffo works.`);
        setChoosing(false);
        return;
      }
      update({ [field]: place });
      goBack();
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
