import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSession } from '../auth/session';
import { errorMessage } from '../api/client';
import { useCountryConfig } from '../api/useCountryConfig';
import { useResource } from '../api/useResource';
import { useRealtimeEvent } from '../realtime/realtime';
import { useCurrentLocation } from '../location';
import { isActive, AGENT_STATUS, type ErrandView } from '../errands/types';
import { naira } from '../money';
import { useColors } from '../theme/theme';
import { fonts } from '../theme/tokens';
import { Button, Text } from '../ui/kit';
import { Avatar, Badge, Chip, Empty, Icon, List } from '../ui/parts';
import { Art, hasArt } from '../ui/svg';
import { FloatPill, Sheet } from '../ui/floating';
import { JiffoMap } from '../ui/map/map';
import type { MapPin } from '../ui/map/types';
import { usePresence } from './presence';

export type BoardErrand = ErrandView & { distanceMeters: number; agentEarnsKobo: number };
interface Board {
  errands: BoardErrand[];
  hiddenByPreferences: number;
}
interface Earnings {
  todayKobo: number;
  tier: 'bronze' | 'silver' | 'gold' | 'platinum';
}
type Sort = 'near' | 'fee' | 'buy';

const RADIUS_KM = 10;
const REFRESH_MS = 20_000;
export const km = (m: number) => (m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1)} km`);
const TIER_NAME = { bronze: 'Bronze', silver: 'Silver', gold: 'Gold', platinum: 'Platinum' } as const;

/**
 * The agent's home, after the prototype: the map with nearby errands and today's earnings. Offline, a GO
 * button; online, the board of open errands near them, filtered by their preferences on the server.
 */
export function AgentBoard() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { api, user } = useSession();
  const presence = usePresence();
  const here = useCurrentLocation();
  const earnings = useResource<Earnings>('/v1/wallet');
  const mine = useResource<ErrandView[]>('/v1/errands?limit=10');
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>('near');
  const [sheetHeight, setSheetHeight] = useState(0);
  const [areaHeight, setAreaHeight] = useState(0);
  useRealtimeEvent('errand.updated', mine.reloadSoon);
  useRealtimeEvent('wallet.updated', earnings.reloadSoon);

  // Centre the map on the agent even while offline, without sharing anything.
  const { peek } = here;
  useEffect(() => {
    void peek();
  }, [peek]);
  const at = presence.coords ?? here.coords;

  // The position is read through a ref so a new GPS fix doesn't restart the 20-second rhythm.
  const coordsRef = useRef(presence.coords);
  coordsRef.current = presence.coords;
  const load = useCallback(async () => {
    const here = coordsRef.current;
    if (!presence.online || !here) return;
    const { lat, lng } = here;
    try {
      setBoard(await api.get<Board>(`/v1/errands/board?lat=${lat}&lng=${lng}&radiusKm=${RADIUS_KM}`));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [api, presence.online]);
  // The first fix after going online loads the board straight away.
  const located = !!presence.coords;
  useEffect(() => {
    if (located) void load();
  }, [located, load]);
  // New errands don't arrive as live events yet, so the board checks every 20 seconds while in front.
  useFocusEffect(
    useCallback(() => {
      void load();
      const timer = setInterval(load, REFRESH_MS);
      return () => clearInterval(timer);
    }, [load]),
  );

  const jobs = useMemo(() => {
    const list = [...(board?.errands ?? [])];
    if (sort === 'fee') list.sort((a, b) => b.feeKobo - a.feeKobo);
    if (sort === 'buy') return list.filter((j) => j.buy);
    return list;
  }, [board, sort]);
  const active = mine.data?.filter(isActive) ?? [];
  const online = presence.online;

  const pins: MapPin[] = [
    ...(online ? jobs : []).map((j) => ({
      key: j.id,
      kind: 'fee' as const,
      label: naira(j.feeKobo),
      lat: j.stops[0]!.lat,
      lng: j.stops[0]!.lng,
      onPress: () => router.push(`/errand/${j.id}`),
    })),
    ...(at ? [{ key: 'me', kind: 'me' as const, lat: at.lat, lng: at.lng }] : []),
  ];

  return (
    <View style={[styles.fill, { backgroundColor: c.bg }]} onLayout={(e) => setAreaHeight(e.nativeEvent.layout.height)}>
      <JiffoMap pins={pins} center={at} insets={{ top: insets.top + 64, bottom: sheetHeight }} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Your account"
        onPress={() => router.push('/account')}
        style={[styles.me, { top: insets.top + 12 }]}
      >
        <Avatar name={user?.firstName} size={44} />
      </Pressable>
      <View pointerEvents="box-none" style={[styles.centerRow, { top: insets.top + 14 }]}>
        <FloatPill
          label={`Earned today, ${earnings.data ? naira(earnings.data.todayKobo) : 'loading'}`}
          onPress={() => router.push('/wallet')}
          style={{ ...styles.earnPill, backgroundColor: c.ink }}
        >
          <Text style={[styles.earnAmount, { color: c.onInk }]}>
            {earnings.data ? naira(earnings.data.todayKobo) : '…'}
          </Text>
          <Text style={[styles.earnToday, { color: c.onInk }]}>today</Text>
        </FloatPill>
      </View>

      {!online ? (
        <GoButton bottom={sheetHeight + 20} busy={presence.switching} onPress={() => presence.setOnline(true)} />
      ) : null}

      <Sheet
        aboveTabs
        onHeight={setSheetHeight}
        maxHeight={areaHeight ? Math.max(260, areaHeight - insets.top - 200) : undefined}
      >
        {active.map((e) => (
          <Pressable
            key={e.id}
            accessibilityRole="button"
            accessibilityLabel={`${AGENT_STATUS[e.status]}. Open your errand`}
            onPress={() => router.push(`/errand/${e.id}`)}
            style={[styles.live, { backgroundColor: c.ink }]}
          >
            <View style={[styles.liveIco, { backgroundColor: 'rgba(255,255,255,0.14)' }]}>
              <Icon name="route" size={19} color={c.onInk} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[styles.liveTitle, { color: c.onInk }]} numberOfLines={1}>
                {e.description}
              </Text>
              <Text variant="note" style={{ color: c.onInk, opacity: 0.75 }} numberOfLines={1}>
                {AGENT_STATUS[e.status]}
              </Text>
            </View>
            <Icon name="chev" size={20} color={c.onInk} />
          </Pressable>
        ))}

        {online ? (
          <OnlineHead onOffline={() => presence.setOnline(false)} busy={presence.switching} />
        ) : (
          <OfflineHead tier={earnings.data?.tier} />
        )}

        {presence.error ? (
          <View style={[styles.notice, { backgroundColor: c.urgentSoft }]}>
            <Text variant="small">{presence.error}</Text>
            {presence.blocked ? (
              <Button kind="secondary" small label="Open Settings" onPress={presence.openSettings} />
            ) : null}
          </View>
        ) : null}

        {online ? (
          <>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
              <Chip label="Preferences" icon="tune" onPress={() => router.push('/preferences')} />
              <Chip label="Nearest" selected={sort === 'near'} onPress={() => setSort('near')} />
              <Chip label="Highest fee" selected={sort === 'fee'} onPress={() => setSort('fee')} />
              <Chip label="Buying items" selected={sort === 'buy'} onPress={() => setSort('buy')} />
            </ScrollView>
            {error ? <Text tone="danger">{error}</Text> : null}
            {board?.hiddenByPreferences ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push('/preferences')}
                style={[styles.hidden, { backgroundColor: c.surface2 }]}
              >
                <Icon name="eyeoff" size={20} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.hiddenTitle}>
                    {board.hiddenByPreferences} {board.hiddenByPreferences === 1 ? 'errand' : 'errands'} nearby left out
                    by your preferences
                  </Text>
                  <Text variant="note" tone="ink3">
                    Change what you take
                  </Text>
                </View>
                <Icon name="chev" size={18} />
              </Pressable>
            ) : null}
            {board && jobs.length === 0 ? (
              <Empty
                icon="search"
                title="No errands right now"
                body={`New errands within ${RADIUS_KM} km show here and on the map. This list updates by itself.`}
              />
            ) : null}
            <List inset={72}>
              {jobs.map((j) => (
                <JobRow key={j.id} job={j} />
              ))}
            </List>
          </>
        ) : null}
      </Sheet>
    </View>
  );
}

/** The big round GO button over the map, as in the prototype. */
function GoButton({ bottom, busy, onPress }: { bottom: number; busy: boolean; onPress: () => void }) {
  const c = useColors();
  return (
    <View pointerEvents="box-none" style={[styles.centerRow, { bottom }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Go online"
        accessibilityState={{ busy }}
        disabled={busy}
        onPress={onPress}
        style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.95 : 1 }] })}
      >
        <View style={[styles.goRing, { backgroundColor: 'rgba(39,110,241,0.22)' }]}>
          <View style={[styles.go, { backgroundColor: c.blue, opacity: busy ? 0.6 : 1 }]}>
            <Text style={styles.goText}>GO</Text>
          </View>
        </View>
      </Pressable>
    </View>
  );
}

function OfflineHead({ tier }: { tier?: Earnings['tier'] }) {
  const c = useColors();
  return (
    <>
      <View style={styles.head}>
        <View style={[styles.dot, { backgroundColor: c.ink3 }]} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.headTitle} accessibilityRole="header">
            You&apos;re offline
          </Text>
          <Text variant="small" tone="ink2">
            Go online to see errands near you. Your location is shared only while online or on an errand.
          </Text>
        </View>
      </View>
      {tier ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/wallet')}
          style={[styles.tier, { backgroundColor: c.surface2 }]}
        >
          <View style={[styles.tierBadge, { backgroundColor: '#8C5A2B' }]}>
            <Text style={styles.tierLetter}>{TIER_NAME[tier][0]}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.tierTitle}>{TIER_NAME[tier]} tier</Text>
            <Text variant="note" tone="ink3">
              {tier === 'bronze'
                ? 'Silver means lower commission and instant earnings'
                : 'Lower commission and instant earnings'}
            </Text>
          </View>
          <Icon name="chev" size={18} />
        </Pressable>
      ) : null}
    </>
  );
}

function OnlineHead({ onOffline, busy }: { onOffline: () => void; busy: boolean }) {
  const c = useColors();
  return (
    <View style={styles.head}>
      <View style={[styles.dot, { backgroundColor: c.brand2 }]} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.headTitle} accessibilityRole="header">
          You&apos;re online
        </Text>
        <Text variant="small" tone="ink3">
          Errands within {RADIUS_KM} km of you
        </Text>
      </View>
      <Button
        kind="secondary"
        small
        label="Go offline"
        icon={<Icon name="power" size={16} />}
        onPress={onOffline}
        loading={busy}
      />
    </View>
  );
}

/** One open errand on the board: what, how far, what kind, and the fee. */
function JobRow({ job }: { job: BoardErrand }) {
  const c = useColors();
  const { config } = useCountryConfig();
  const cat = config?.categories.find((k) => k.key === job.categoryKey);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${job.description}, ${naira(job.feeKobo)}, ${km(job.distanceMeters)} away`}
      onPress={() => router.push(`/errand/${job.id}`)}
      style={({ pressed }) => [styles.job, pressed && { opacity: 0.6 }]}
    >
      <View style={[styles.jobThumb, { backgroundColor: c.surface2 }]}>
        {cat && hasArt(cat.key) ? <Art name={cat.key} size={40} /> : <Icon name={cat?.icon ?? 'bag'} size={26} />}
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <Text style={styles.jobTitle} numberOfLines={1}>
          {job.description}
        </Text>
        <Text variant="note" tone="ink3" numberOfLines={1}>
          {[cat?.name, `${km(job.distanceMeters)} away`].filter(Boolean).join(' · ')}
        </Text>
        {job.urgent || job.buy || job.scheduledFor ? (
          <View style={styles.badges}>
            {job.urgent ? <Badge icon="zap" label="Urgent" tone="urgent" /> : null}
            {job.buy ? <Badge icon="bag" label="Buying items" tone="brand" /> : null}
            {job.scheduledFor ? <Badge icon="cal" label="Scheduled" /> : null}
          </View>
        ) : null}
      </View>
      <View style={{ alignItems: 'flex-end', gap: 2 }}>
        <Text style={styles.jobFee}>{naira(job.feeKobo)}</Text>
        <Text variant="note" tone="ink3">
          you get {naira(job.agentEarnsKobo)}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  me: { position: 'absolute', left: 16, zIndex: 4, borderRadius: 22, boxShadow: '0 2px 10px rgba(0,0,0,0.15)' },
  centerRow: { position: 'absolute', left: 0, right: 0, zIndex: 4, alignItems: 'center' },
  earnPill: { position: 'relative', height: 44, paddingHorizontal: 18, gap: 6 },
  earnAmount: { fontFamily: fonts.extrabold, fontSize: 18, fontVariant: ['tabular-nums'] },
  earnToday: { fontFamily: fonts.semibold, fontSize: 12, opacity: 0.75 },
  goRing: { width: 112, height: 112, borderRadius: 56, alignItems: 'center', justifyContent: 'center' },
  go: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 6px 20px rgba(39,110,241,0.45)',
  },
  goText: { color: '#FFFFFF', fontFamily: fonts.extrabold, fontSize: 22, letterSpacing: 0.5 },
  live: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 14 },
  liveIco: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  liveTitle: { fontFamily: fonts.bold, fontSize: 15 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  dot: { width: 12, height: 12, borderRadius: 6 },
  headTitle: { fontFamily: fonts.bold, fontSize: 20 },
  notice: { padding: 12, borderRadius: 12, gap: 8 },
  tier: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14 },
  tierBadge: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  tierLetter: { color: '#FFFFFF', fontFamily: fonts.bold, fontSize: 16 },
  tierTitle: { fontFamily: fonts.bold, fontSize: 15.5 },
  chips: { flexDirection: 'row', gap: 8 },
  hidden: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14 },
  hiddenTitle: { fontFamily: fonts.semibold, fontSize: 15 },
  job: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 12 },
  jobThumb: { width: 58, height: 58, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  jobTitle: { fontFamily: fonts.bold, fontSize: 16 },
  jobFee: { fontFamily: fonts.extrabold, fontSize: 17, fontVariant: ['tabular-nums'] },
  badges: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
});
