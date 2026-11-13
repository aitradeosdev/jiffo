import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useResource } from '@/api/useResource';
import { useCountryConfig } from '@/api/useCountryConfig';
import { useRealtimeEvent } from '@/realtime/realtime';
import { LiveCard } from '@/errands/live-card';
import { AGENT_BADGE, isActive, type ErrandView } from '@/errands/types';
import { shortWhen, upcoming, whenLabel } from '@/errands/when';
import { VARIANT } from '@/config';
import { naira } from '@/money';
import { useColors } from '@/theme/theme';
import { fonts } from '@/theme/tokens';
import { Button, Text } from '@/ui/kit';
import { Badge, Empty, Icon } from '@/ui/parts';
import { Art, hasArt } from '@/ui/svg';
import { TabPage } from '@/ui/tab-page';

/** The Errands (customer) or Jobs (agent) tab: what's running now, what's booked, and the past with totals. */
export default function Errands() {
  const agent = VARIANT === 'agent';
  const { data, refreshing, refresh, reloadSoon } = useResource<ErrandView[]>('/v1/errands?limit=50');
  useRealtimeEvent('errand.updated', reloadSoon);
  const booked = (e: ErrandView) => e.status === 'requested' && !!upcoming(e.scheduledFor);
  const now = data?.filter((e) => isActive(e) && !booked(e)) ?? [];
  const later = data?.filter(booked) ?? [];
  const past = data?.filter((e) => !isActive(e)) ?? [];
  // Read once here rather than in every row.
  const { config } = useCountryConfig();
  const categories = new Map(config?.categories.map((k) => [k.key, k]) ?? []);
  const row = (e: ErrandView) => <ErrandRow key={e.id} errand={e} category={categories.get(e.categoryKey)} />;

  return (
    <TabPage title="Errands" refreshing={refreshing} onRefresh={refresh}>
      {data && data.length === 0 ? (
        <Empty
          icon="history"
          title="No errands yet"
          body={
            agent
              ? 'Errands you accept show here, with what you earned.'
              : 'Errands you request show here, with a receipt for each one.'
          }
          action={
            <Button small label={agent ? 'Find errands' : 'Request an errand'} onPress={() => router.push('/home')} />
          }
        />
      ) : null}

      {now.length ? (
        <Block title="Happening now">
          {agent
            ? now.map((e) => <ErrandRow key={e.id} errand={e} />)
            : now.map((e) => <LiveCard key={e.id} errand={e} />)}
        </Block>
      ) : null}
      {later.length ? <Block title="Upcoming">{later.map(row)}</Block> : null}
      {past.length ? <Block title="Past">{past.map(row)}</Block> : null}
    </TabPage>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ gap: 4 }}>
      <Text variant="sec" accessibilityRole="header" style={{ marginBottom: 8 }}>
        {title}
      </Text>
      {children}
    </View>
  );
}

/** .erow: the category's picture, what it was, when and where, and the total or how it ended. */
function ErrandRow({ errand: e, category }: { errand: ErrandView; category?: { key: string; icon: string } }) {
  const c = useColors();
  const agent = VARIANT === 'agent';
  const place = e.stops.find((s) => s.kind === (agent ? 'pickup' : 'dropoff'));
  const other = agent ? e.customer?.firstName : e.agent?.firstName;
  const scheduled = e.status === 'requested' ? upcoming(e.scheduledFor) : null;
  const when = scheduled ? whenLabel(scheduled) : shortWhen(e.completedAt ?? e.cancelledAt ?? e.createdAt);
  // Item money counts only if the customer locked it; an unlocked amount was never paid.
  const total = agent
    ? (e.earnedKobo ?? e.feeKobo)
    : e.feeKobo + e.serviceFeeKobo + (e.itemsLocked ? (e.itemAmountKobo ?? 0) : 0);
  const right =
    e.status === 'completed' ? (
      <Text style={styles.amt}>{naira(total)}</Text>
    ) : e.status === 'cancelled' ? (
      <Badge label="Cancelled" />
    ) : e.status === 'expired' ? (
      <Badge label="No agent" />
    ) : scheduled ? (
      <Badge label="Booked" />
    ) : agent ? (
      <Badge label={AGENT_BADGE[e.status] ?? 'Open'} tone="brand" />
    ) : null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${e.description}, ${when}`}
      onPress={() => router.push(`/errand/${e.id}`)}
      style={({ pressed }) => [styles.erow, pressed && { opacity: 0.6 }]}
    >
      <View style={[styles.thumb, { backgroundColor: c.surface2 }]}>
        {category && hasArt(category.key) ? (
          <Art name={category.key} size={34} />
        ) : (
          <Icon name={category?.icon ?? 'bag'} size={22} />
        )}
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text style={styles.title} numberOfLines={1}>
          {e.description}
        </Text>
        <Text style={[styles.small, { color: c.ink3 }]}>{when}</Text>
        <Text style={[styles.small, { color: c.ink3 }]} numberOfLines={1}>
          {[place?.label ?? place?.address, other].filter(Boolean).join(' · ')}
        </Text>
      </View>
      {right}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  erow: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 76, paddingVertical: 10 },
  thumb: { width: 48, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: fonts.bold, fontSize: 16 },
  small: { fontSize: 13.5, lineHeight: 18 },
  amt: { fontFamily: fonts.bold, fontSize: 15, fontVariant: ['tabular-nums'] },
});
