import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { VARIANT } from '@/config';
import { AgentBoard } from '@/agent/board';
import { useCountryConfig } from '@/api/useCountryConfig';
import { useResource } from '@/api/useResource';
import { useRealtimeEvent } from '@/realtime/realtime';
import { useDraft } from '@/errands/draft';
import { STATUS_TEXT, isActive, type ErrandView } from '@/errands/types';
import { naira } from '@/money';
import { useColors } from '@/theme/theme';
import { radius, space } from '@/theme/tokens';
import { Screen, Text, Wordmark } from '@/ui/kit';
import { Card, CategoryIcon, Icon, Row, Section } from '@/ui/parts';

export default function Home() {
  return VARIANT === 'customer' ? <CustomerHome /> : <AgentBoard />;
}

function CustomerHome() {
  const c = useColors();
  const { config } = useCountryConfig();
  const { update, reset } = useDraft();
  const wallet = useResource<{ balanceKobo: number }>('/v1/wallet');
  const errands = useResource<ErrandView[]>('/v1/errands?limit=5');
  useRealtimeEvent('errand.updated', errands.reloadSoon);
  useRealtimeEvent('wallet.updated', wallet.reloadSoon);
  const live = errands.data?.filter(isActive) ?? [];

  const start = (categoryKey: string | null) => {
    reset();
    if (categoryKey) update({ categoryKey });
    router.push('/plan');
  };

  return (
    <Screen>
      <View style={styles.top}>
        <Wordmark height={30} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Wallet, ${wallet.data ? naira(wallet.data.balanceKobo) : 'loading'}`}
          onPress={() => router.push('/wallet')}
          style={[styles.pill, { backgroundColor: c.surface2 }]}
        >
          <Icon name="credit-card" size={16} />
          <Text variant="label">{wallet.data ? naira(wallet.data.balanceKobo) : '…'}</Text>
        </Pressable>
      </View>

      {live.map((e) => (
        <Pressable key={e.id} accessibilityRole="button" onPress={() => router.push(`/errand/${e.id}`)}>
          <Card tone="brand">
            <Text variant="label">{STATUS_TEXT[e.status]}</Text>
            <Text variant="small" tone="ink2" numberOfLines={1}>
              {e.description}
            </Text>
          </Card>
        </Pressable>
      ))}

      {wallet.data && wallet.data.balanceKobo === 0 ? (
        <Row
          icon="plus"
          tone="brand"
          title="Add money to request your first errand"
          subtitle="Transfer from any bank app"
          onPress={() => router.push('/topup')}
        />
      ) : null}

      <Text variant="title">What do you need done?</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Describe your errand"
        onPress={() => start(null)}
        style={[styles.search, { backgroundColor: c.surface2 }]}
      >
        <Icon name="search" size={20} />
        <Text variant="label" tone="ink3">
          Describe your errand
        </Text>
      </Pressable>

      <Section title="Categories">
        <View style={styles.grid}>
          {config?.categories.map((cat) => (
            <Pressable
              key={cat.key}
              accessibilityRole="button"
              accessibilityLabel={cat.name}
              onPress={() => start(cat.key)}
              style={styles.cell}
            >
              <View style={[styles.tile, { backgroundColor: c.surface2 }]}>
                <CategoryIcon icon={cat.icon} size={26} />
              </View>
              <Text variant="small" numberOfLines={2} style={{ textAlign: 'center' }}>
                {cat.name}
              </Text>
            </Pressable>
          ))}
        </View>
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    height: 38,
    borderRadius: radius.pill,
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    height: 56,
    borderRadius: radius.md,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: space.lg },
  cell: { width: '25%', alignItems: 'center', gap: 6, paddingHorizontal: 2 },
  tile: { width: 60, height: 60, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
});
