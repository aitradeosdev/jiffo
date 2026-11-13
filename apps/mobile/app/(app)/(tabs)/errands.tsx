import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useResource } from '@/api/useResource';
import { useCountryConfig } from '@/api/useCountryConfig';
import { useRealtimeEvent } from '@/realtime/realtime';
import { LiveCard } from '@/errands/live-card';
import { AGENT_STATUS, isActive, type ErrandView } from '@/errands/types';
import { shortWhen, upcoming, whenLabel } from '@/errands/when';
import { VARIANT } from '@/config';
import { naira } from '@/money';
import { useColors } from '@/theme/theme';
import { fonts } from '@/theme/tokens';
import { Button, Text } from '@/ui/kit';
import { Badge, Icon, IconCircle } from '@/ui/parts';
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

  return (
    <TabPage title={agent ? 'Jobs' : 'Errands'} refreshing={refreshing} onRefresh={refresh}>
      {data && data.length === 0 ? (
        <View style={styles.empty}>
          <IconCircle icon="history" size={52} />
          <Text style={styles.emptyTitle}>{agent ? 'No jobs yet' : 'No errands yet'}</Text>
          <Text variant="note" tone="ink3" style={{ textAlign: 'center' }}>
            {agent
              ? 'Errands you accept show here, with what you earned.'
              : 'Errands you request show here, with a receipt for each one.'}
          </Text>
          <Button small label={agent ? 'Find errands' : 'Request an errand'} onPress={() => router.push('/home')} />
        </View>
      ) : null}

      {now.length ? (
        <Block title="Happening now">
          {agent
            ? now.map((e) => <ErrandRow key={e.id} errand={e} />)
            : now.map((e) => <LiveCard key={e.id} errand={e} />)}
        </Block>
      ) : null}
      {later.length ? (
        <Block title="Upcoming">
          {later.map((e) => (
            <ErrandRow key={e.id} errand={e} />
          ))}
        </Block>
      ) : null}
      {past.length ? (
        <Block title="Past">
          {past.map((e) => (
            <ErrandRow key={e.id} errand={e} />
          ))}
        </Block>
      ) : null}
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
function ErrandRow({ errand: e }: { errand: ErrandView }) {
  const c = useColors();
  const { config } = useCountryConfig();
  const agent = VARIANT === 'agent';
  const category = config?.categories.find((k) => k.key === e.categoryKey);
  const place = e.stops.find((s) => s.kind === (agent ? 'pickup' : 'dropoff'));
  const other = agent ? e.customer?.firstName : e.agent?.firstName;
  const scheduled = e.status === 'requested' ? upcoming(e.scheduledFor) : null;
  const when = scheduled ? whenLabel(scheduled) : shortWhen(e.completedAt ?? e.cancelledAt ?? e.createdAt);
  const total = agent ? e.feeKobo : e.feeKobo + e.serviceFeeKobo + (e.itemAmountKobo ?? 0);
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
      <Badge label={AGENT_STATUS[e.status]} tone="brand" />
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
  empty: { alignItems: 'center', gap: 8, paddingVertical: 40, paddingHorizontal: 24 },
  emptyTitle: { fontFamily: fonts.bold, fontSize: 16 },
  erow: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 76, paddingVertical: 10 },
  thumb: { width: 48, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: fonts.bold, fontSize: 16 },
  small: { fontSize: 13.5, lineHeight: 18 },
  amt: { fontFamily: fonts.bold, fontSize: 15, fontVariant: ['tabular-nums'] },
});
