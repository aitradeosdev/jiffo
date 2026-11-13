import { RefreshControl, ScrollView } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useResource } from '@/api/useResource';
import { useRealtimeEvent } from '@/realtime/realtime';
import { AGENT_STATUS, STATUS_TEXT, isActive, type ErrandView } from '@/errands/types';
import { VARIANT } from '@/config';
import { naira } from '@/money';
import { useColors } from '@/theme/theme';
import { space } from '@/theme/tokens';
import { Button, Text } from '@/ui/kit';
import { Empty, Row, Section } from '@/ui/parts';

export default function Errands() {
  const agent = VARIANT === 'agent';
  const c = useColors();
  const { data, refreshing, refresh, reloadSoon } = useResource<ErrandView[]>('/v1/errands?limit=50');
  useRealtimeEvent('errand.updated', reloadSoon);
  const active = data?.filter(isActive) ?? [];
  const past = data?.filter((e) => !isActive(e)) ?? [];
  const row = (e: ErrandView) => (
    <Row
      key={e.id}
      icon={isActive(e) ? 'clock' : e.status === 'completed' ? 'check' : 'x'}
      title={e.description}
      subtitle={`${(agent ? AGENT_STATUS : STATUS_TEXT)[e.status]} · ${new Date(e.createdAt).toLocaleDateString()}`}
      right={<Text variant="label">{naira(e.feeKobo)}</Text>}
      onPress={() => router.push(`/errand/${e.id}`)}
    />
  );
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top']}>
      <ScrollView
        contentContainerStyle={{ padding: space.lg, gap: space.xl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
      >
        <Text variant="title">{agent ? 'Jobs' : 'Errands'}</Text>
        {data && data.length === 0 ? (
          <Empty
            icon="list"
            title={agent ? 'No jobs yet' : 'No errands yet'}
            body={agent ? 'Errands you accept show here.' : 'Errands you request show here.'}
            action={
              <Button label={agent ? 'Find errands' : 'Request an errand'} onPress={() => router.push('/home')} />
            }
          />
        ) : null}
        {active.length ? <Section title="Happening now">{active.map(row)}</Section> : null}
        {past.length ? <Section title="Past">{past.map(row)}</Section> : null}
      </ScrollView>
    </SafeAreaView>
  );
}
