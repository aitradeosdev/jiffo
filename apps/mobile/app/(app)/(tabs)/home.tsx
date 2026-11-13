import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { VARIANT } from '@/config';
import { AgentBoard } from '@/agent/board';
import { useCountryConfig } from '@/api/useCountryConfig';
import { useResource } from '@/api/useResource';
import { useRealtimeEvent } from '@/realtime/realtime';
import { useDraft } from '@/errands/draft';
import { LiveCard } from '@/errands/live-card';
import { isActive, type ErrandView, type PlacePick } from '@/errands/types';
import { liveSchedule, whenLabel } from '@/errands/when';
import { useCurrentLocation } from '@/location';
import { naira } from '@/money';
import { useColors } from '@/theme/theme';
import { fonts } from '@/theme/tokens';
import { Button, Text, Wordmark } from '@/ui/kit';
import { Icon, List, Row } from '@/ui/parts';
import { Art } from '@/ui/svg';
import { Fab, FloatPill, Sheet, useShadows } from '@/ui/floating';
import { JiffoMap } from '@/ui/map/map';
import type { MapHandle } from '@/ui/map/types';

export default function Home() {
  return VARIANT === 'customer' ? <CustomerHome /> : <AgentBoard />;
}

/** The illustrated categories, in the prototype's order. */
const TILE_ORDER = ['groceries', 'parcel', 'pharmacy', 'queue'];

/** Short tile names, as on the prototype's home. */
const SHORT: Record<string, string> = {
  groceries: 'Groceries',
  parcel: 'Parcels',
  pharmacy: 'Pharmacy',
  queue: 'Queues',
};

function CustomerHome() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { config } = useCountryConfig();
  const { draft, update, reset } = useDraft();
  const wallet = useResource<{ balanceKobo: number }>('/v1/wallet');
  const errands = useResource<ErrandView[]>('/v1/errands?limit=5');
  useRealtimeEvent('errand.updated', errands.reloadSoon);
  useRealtimeEvent('wallet.updated', wallet.reloadSoon);
  const location = useCurrentLocation();
  const map = useRef<MapHandle>(null);
  const [sheetHeight, setSheetHeight] = useState(0);
  const [areaHeight, setAreaHeight] = useState(0);

  const { peek } = location;
  useEffect(() => {
    void peek();
  }, [peek]);

  const live = errands.data?.filter(isActive) ?? [];
  const recent = useMemo(() => recentPlaces(errands.data ?? []), [errands.data]);
  const tiles = TILE_ORDER.flatMap((key) => config?.categories.find((k) => k.key === key) ?? []);
  const groceries = config?.categories.find((k) => k.key === 'groceries');
  const schedule = liveSchedule(draft.scheduledFor);

  // A new errand starts clean, apart from the time chosen with the Now chip.
  const start = (changes: Parameters<typeof update>[0] = {}) => {
    reset({ scheduledFor: schedule });
    update(changes);
    router.push('/plan');
  };

  const recenter = async () => {
    const at = await location.locate();
    if (at) map.current?.recenter();
  };

  return (
    <View style={[styles.fill, { backgroundColor: c.bg }]} onLayout={(e) => setAreaHeight(e.nativeEvent.layout.height)}>
      <JiffoMap
        ref={map}
        pins={[]}
        center={location.coords ?? recent[0]?.place ?? null}
        showsUser={!!location.coords}
        insets={{ top: insets.top + 64, bottom: sheetHeight }}
      />
      <FloatPill label="Jiffo" style={{ top: insets.top + 14, left: 16 }}>
        <Wordmark height={24} />
      </FloatPill>
      <FloatPill
        label={`Wallet, ${wallet.data ? naira(wallet.data.balanceKobo) : 'loading'}`}
        onPress={() => router.push('/wallet')}
        style={{ top: insets.top + 14, right: 16 }}
      >
        <Icon name="wallet" size={17} />
        <Text style={styles.pillText}>{wallet.data ? naira(wallet.data.balanceKobo) : '…'}</Text>
      </FloatPill>
      <Fab icon="locate" label="Show my location" onPress={recenter} style={{ right: 16, bottom: sheetHeight + 12 }} />

      <Sheet
        aboveTabs
        onHeight={setSheetHeight}
        maxHeight={areaHeight ? Math.max(260, areaHeight - insets.top - 170) : undefined}
      >
        {live.map((e) => (
          <LiveCard key={e.id} errand={e} />
        ))}
        {location.blocked ? (
          <Row
            icon="locate"
            tone="urgent"
            title="Location is off for Jiffo"
            subtitle="Turn it on in Settings to see where you are"
            onPress={location.openSettings}
          />
        ) : null}

        {wallet.data && wallet.data.balanceKobo === 0 && !live.length ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/topup')}
            style={[styles.addcard, { backgroundColor: c.brandSoft }]}
          >
            <View style={[styles.ico, { backgroundColor: c.surface }]}>
              <Icon name="bank" size={19} color={c.brandInk} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="label" style={{ fontSize: 15 }}>
                Add money to request your first errand
              </Text>
              <Text variant="note" tone="ink2">
                Transfer to your own account number from any bank app
              </Text>
            </View>
            <Icon name="chev" size={18} />
          </Pressable>
        ) : null}

        <Text variant="title" accessibilityRole="header">
          What do you need done?
        </Text>
        <WhereTo when={whenLabel(schedule)} onPress={() => start()} />

        {recent.length ? (
          <List>
            {recent.map((r) => (
              <Row
                key={r.place.address}
                icon={r.kind === 'dropoff' ? 'home' : 'history'}
                title={r.place.name}
                subtitle={
                  r.kind === 'dropoff'
                    ? `${r.place.address} · your last drop-off`
                    : `${r.place.address} · your last errand`
                }
                right={null}
                onPress={() => start(r.kind === 'dropoff' ? { dropoff: r.place } : { pickup: r.place })}
              />
            ))}
          </List>
        ) : null}

        <View style={styles.secRow}>
          <Text variant="sec" accessibilityRole="header">
            Categories
          </Text>
          <Button
            label="See all"
            kind="secondary"
            small
            onPress={() => {
              reset({ scheduledFor: schedule });
              router.push({ pathname: '/category', params: { then: 'plan' } });
            }}
          />
        </View>
        <View style={styles.sugs}>
          {tiles.map((k) => (
            <Pressable
              key={k.key}
              accessibilityRole="button"
              accessibilityLabel={k.name}
              onPress={() => start({ categoryKey: k.key })}
              style={styles.sug}
            >
              {({ pressed }) => (
                <>
                  <View
                    style={[styles.sugBox, { backgroundColor: c.surface2, transform: [{ scale: pressed ? 0.95 : 1 }] }]}
                  >
                    <Art name={k.key} size={48} />
                  </View>
                  <Text style={styles.sugText} numberOfLines={1}>
                    {SHORT[k.key] ?? k.name}
                  </Text>
                </>
              )}
            </Pressable>
          ))}
        </View>

        {groceries ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Groceries without the traffic. Try a grocery run"
            onPress={() => start({ categoryKey: groceries.key })}
            style={[styles.promo, { backgroundColor: c.promo }]}
          >
            <View style={styles.promoGlow} />
            <View style={{ flex: 1, gap: 6 }}>
              <Text style={styles.promoTitle}>Groceries without the traffic</Text>
              <Text style={styles.promoBody}>
                An agent buys with their own money. You pay for items only when they&apos;re in your hands.
              </Text>
              <View style={styles.promoGo}>
                <Text style={styles.promoGoText}>Try a grocery run</Text>
                <Icon name="right" size={14} weight={2.4} color="#0A3B26" />
              </View>
            </View>
            <Art name="groceries" size={96} />
          </Pressable>
        ) : null}
      </Sheet>
    </View>
  );
}

/** .whereto: the big search bar, with the Now / Later pill inside it. */
function WhereTo({ when, onPress }: { when: string; onPress: () => void }) {
  const c = useColors();
  const { sh1 } = useShadows();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Describe your errand"
      onPress={onPress}
      style={[styles.whereto, { backgroundColor: c.surface2 }]}
    >
      <Icon name="search" size={22} weight={2.4} />
      <Text style={[styles.wheretoText, { color: c.ink2 }]}>Describe your errand</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`When: ${when}. Change`}
        onPress={() => router.push('/when')}
        style={[styles.when, { backgroundColor: c.surface, boxShadow: sh1 }]}
      >
        <Icon name="clock" size={16} />
        <Text style={styles.whenText} numberOfLines={1}>
          {when === 'Now' ? 'Now' : 'Later'}
        </Text>
        <Icon name="down" size={15} />
      </Pressable>
    </Pressable>
  );
}

/** The last two different places from past errands, kept as the kind of stop they were. */
function recentPlaces(errands: ErrandView[]) {
  const seen = new Set<string>();
  const out: Array<{ kind: 'pickup' | 'dropoff'; place: PlacePick }> = [];
  for (const e of errands) {
    for (const s of [...e.stops].reverse()) {
      if (s.kind === 'stop' || seen.has(s.address)) continue;
      seen.add(s.address);
      out.push({
        kind: s.kind,
        place: {
          placeId: `recent:${s.lat},${s.lng}`,
          name: s.label ?? s.address,
          address: s.address,
          lat: s.lat,
          lng: s.lng,
          stateCode: e.stateCode,
        },
      });
      if (out.length === 2) return out;
    }
  }
  return out;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  pillText: { fontFamily: fonts.bold, fontSize: 14, fontVariant: ['tabular-nums'] },
  ico: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  addcard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 14 },
  whereto: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    height: 56,
    paddingLeft: 16,
    paddingRight: 8,
    borderRadius: 12,
  },
  wheretoText: { flex: 1, fontFamily: fonts.semibold, fontSize: 17 },
  when: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 40, paddingHorizontal: 12, borderRadius: 999 },
  whenText: { fontFamily: fonts.semibold, fontSize: 14 },
  secRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 },
  sugs: { flexDirection: 'row', gap: 10 },
  sug: { flex: 1, alignItems: 'center', gap: 6 },
  sugBox: { width: '100%', aspectRatio: 1, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  sugText: { fontFamily: fonts.semibold, fontSize: 13 },
  promo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 118,
    padding: 16,
    borderRadius: 16,
    overflow: 'hidden',
  },
  promoGlow: {
    position: 'absolute',
    right: -50,
    top: -50,
    width: 190,
    height: 190,
    borderRadius: 95,
    backgroundColor: 'rgba(61,214,140,0.16)',
  },
  promoTitle: { color: '#FFFFFF', fontFamily: fonts.bold, fontSize: 18, lineHeight: 22 },
  promoBody: { color: '#BFE5CF', fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  promoGo: {
    alignSelf: 'flex-start',
    marginTop: 4,
    height: 32,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  promoGoText: { color: '#0A3B26', fontFamily: fonts.bold, fontSize: 13 },
});
