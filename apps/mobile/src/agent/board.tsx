import { useCallback, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSession } from '../auth/session';
import { errorMessage } from '../api/client';
import { useCountryConfig } from '../api/useCountryConfig';
import { useResource } from '../api/useResource';
import { useRealtimeEvent } from '../realtime/realtime';
import { useCurrentLocation } from '../location';
import { isActive, type ErrandView } from '../errands/types';
import { naira } from '../money';
import { useColors } from '../theme/theme';
import { space } from '../theme/tokens';
import { Button, Text, Wordmark } from '../ui/kit';
import { Card, Chip, Empty, Row, Section } from '../ui/parts';

type BoardErrand = ErrandView & { distanceMeters: number };
type Sort = 'near' | 'fee' | 'buy';
const REFRESH_MS = 20_000;
const km = (m: number) => (m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1)} km`);

/** Open errands near the agent, filtered by their preferences on the server, nearest first. */
export function AgentBoard() {
  const c = useColors();
  const { api, user } = useSession();
  const { config } = useCountryConfig();
  const { error: locationError, blocked, locate, openSettings } = useCurrentLocation();
  const mine = useResource<ErrandView[]>('/v1/errands?limit=10');
  const [jobs, setJobs] = useState<BoardErrand[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [sort, setSort] = useState<Sort>('near');
  useRealtimeEvent('errand.updated', mine.reloadSoon);

  // Each refresh reads the location again, so "near you" follows the agent as they move.
  const load = useCallback(async () => {
    const here = await locate();
    if (!here) return;
    try {
      setJobs(await api.get<BoardErrand[]>(`/v1/errands/board?lat=${here.lat}&lng=${here.lng}&radiusKm=10`));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [api, locate]);
  // New errands don't arrive as live events yet, so the board checks every 20 seconds, only while it is
  // the screen in front.
  useFocusEffect(
    useCallback(() => {
      load();
      const timer = setInterval(load, REFRESH_MS);
      return () => clearInterval(timer);
    }, [load]),
  );

  const shown = useMemo(() => {
    const list = [...(jobs ?? [])];
    if (sort === 'fee') list.sort((a, b) => b.feeKobo - a.feeKobo);
    if (sort === 'buy') return list.filter((j) => j.buy);
    return list;
  }, [jobs, sort]);
  const active = mine.data?.filter(isActive) ?? [];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top']}>
      <ScrollView
        contentContainerStyle={{ padding: space.lg, gap: space.lg }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await Promise.all([load(), mine.reload()]);
              setRefreshing(false);
            }}
          />
        }
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <Wordmark height={28} />
          <Text variant="label" tone="brand">
            Agent
          </Text>
        </View>
        <Text variant="title">{user?.firstName ? `Hi ${user.firstName}` : 'Errands near you'}</Text>

        {active.map((e) => (
          <Row
            key={e.id}
            icon="navigation"
            tone="brand"
            title={e.description}
            subtitle="Your errand in progress"
            onPress={() => router.push(`/errand/${e.id}`)}
          />
        ))}

        <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
          <Chip label="Preferences" icon="sliders" onPress={() => router.push('/preferences')} />
          <Chip label="Nearest" selected={sort === 'near'} onPress={() => setSort('near')} />
          <Chip label="Highest fee" selected={sort === 'fee'} onPress={() => setSort('fee')} />
          <Chip label="Buying items" selected={sort === 'buy'} onPress={() => setSort('buy')} />
        </View>

        {locationError ? (
          <Card tone="urgent">
            <Text>{locationError}</Text>
            {blocked ? (
              <Button kind="secondary" label="Open Settings" onPress={openSettings} />
            ) : (
              <Button kind="secondary" label="Try again" onPress={load} />
            )}
          </Card>
        ) : null}
        {error ? <Text tone="danger">{error}</Text> : null}

        <Section title="Open errands within 10 km">
          {jobs && shown.length === 0 ? (
            <Empty
              icon="inbox"
              title="No errands right now"
              body="New errands near you show here. This list updates by itself."
            />
          ) : null}
          {shown.map((j) => {
            const cat = config?.categories.find((k) => k.key === j.categoryKey);
            return (
              <Row
                key={j.id}
                icon={cat?.icon ?? 'spark'}
                title={j.description}
                subtitle={[
                  cat?.name,
                  `${km(j.distanceMeters)} away`,
                  j.urgent ? 'Urgent' : null,
                  j.buy ? 'Buying items' : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                right={<Text variant="label">{naira(j.feeKobo)}</Text>}
                onPress={() => router.push(`/errand/${j.id}`)}
              />
            );
          })}
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}
