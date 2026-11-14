import { agentTierLabel } from '@jiffo/shared';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useResource } from '../api/useResource';
import { useRealtimeEvent } from '../realtime/realtime';
import { naira } from '../money';
import { useColors } from '../theme/theme';
import { fonts } from '../theme/tokens';
import { shortWhen } from '../errands/when';
import { TabPage } from '../ui/tab-page';
import { Button, Text } from '../ui/kit';
import { Chip, Empty, Icon, List, Row } from '../ui/parts';

interface AgentWallet {
  availableKobo: number;
  heldKobo: number;
  todayKobo: number;
  week: Array<{ date: string; earnedKobo: number }>;
  tier: 'bronze' | 'silver' | 'gold' | 'platinum';
  upcoming: Array<{ amountKobo: number; availableAt: string }>;
}
interface Withdrawal {
  id: string;
  speed: 'instant' | 'scheduled';
  status: 'requested' | 'processing' | 'succeeded' | 'failed';
  amountKobo: number;
  sendKobo: number;
  failureReason: string | null;
  createdAt: string;
}
interface PayoutAccount {
  bankName: string;
  accountNumber: string;
  accountName: string;
  /** The only account, and support is still checking it. */
  inReview?: boolean;
  /** A new account support is checking; withdrawals go to the one above meanwhile. */
  pending?: { bankName: string; accountNumber: string; accountName: string } | null;
}

const STATUS = {
  requested: 'Queued',
  processing: 'On its way',
  succeeded: 'Paid',
  failed: 'Returned to balance',
} as const;

type Range = 'today' | 'week';

/** The agent's money, after the prototype: the week as a bar chart, what can be withdrawn, and the tier. */
export function AgentEarnings() {
  const c = useColors();
  const wallet = useResource<AgentWallet>('/v1/wallet');
  const withdrawals = useResource<Withdrawal[]>('/v1/wallet/withdrawals');
  const account = useResource<PayoutAccount | null>('/v1/payout-account');
  const [refreshing, setRefreshing] = useState(false);
  const [range, setRange] = useState<Range>('week');
  const reloadSoon = () => {
    wallet.reloadSoon();
    withdrawals.reloadSoon();
  };
  useRealtimeEvent('wallet.updated', reloadSoon);
  useRealtimeEvent('errand.updated', reloadSoon);
  const w = wallet.data;
  const week = w?.week ?? [];
  const first = week[0] ? dayOf(week[0].date) : null;
  const last = week[week.length - 1] ? dayOf(week[week.length - 1]!.date) : null;
  const total = range === 'today' ? (w?.todayKobo ?? 0) : week.reduce((sum, d) => sum + d.earnedKobo, 0);

  return (
    <TabPage
      title="Earnings"
      gap={18}
      refreshing={refreshing}
      onRefresh={async () => {
        setRefreshing(true);
        await Promise.all([wallet.reload(), withdrawals.reload(), account.reload()]);
        setRefreshing(false);
      }}
    >
      <View style={styles.chips}>
        <Chip label="Today" selected={range === 'today'} onPress={() => setRange('today')} />
        <Chip label="This week" selected={range === 'week'} onPress={() => setRange('week')} />
      </View>
      <View style={{ gap: 2 }}>
        <Text variant="small" tone="ink3">
          {range === 'today' || !first || !last
            ? `Today${last ? `, ${fmtDay(last)}` : ''}`
            : `${fmtDay(first)} to ${fmtDay(last)}`}
        </Text>
        <Text style={styles.total} accessibilityLiveRegion="polite">
          {w ? naira(total) : '…'}
        </Text>
        <Text variant="note" tone="ink3">
          After commission, tips included. Item money is shown separately.
        </Text>
      </View>
      {range === 'week' && week.length ? <WeekChart week={week} /> : null}

      <View style={[styles.withdraw, { backgroundColor: c.ink }]}>
        <Text style={[styles.withdrawLabel, { color: c.onInk }]}>Available to withdraw</Text>
        <Text style={[styles.withdrawAmount, { color: c.onInk }]}>{w ? naira(w.availableKobo) : '…'}</Text>
        <Button
          small
          label="Withdraw"
          icon={<Icon name="bank" size={16} color={c.ink} />}
          disabled={!w || w.availableKobo <= 0}
          onPress={() => router.push('/withdraw')}
          tint={{ bg: c.onInk, fg: c.ink }}
          style={{ alignSelf: 'flex-start' }}
        />
        {w && w.heldKobo > 0 ? (
          <View style={[styles.clears, { borderTopColor: 'rgba(255,255,255,0.18)' }]}>
            <Text variant="small" style={{ color: c.onInk, flex: 1 }}>
              {w.upcoming[0]
                ? `Next clears ${shortWhen(w.upcoming[0].availableAt)} (${agentTierLabel(w.tier)})`
                : `Clearing soon (${agentTierLabel(w.tier)})`}
            </Text>
            <Text style={[styles.clearsAmount, { color: c.onInk }]}>{naira(w.heldKobo)}</Text>
          </View>
        ) : null}
      </View>

      {w ? (
        <View style={{ gap: 10 }}>
          <Text variant="sec">Your tier</Text>
          <View style={[styles.tier, { backgroundColor: c.surface2 }]}>
            <View style={[styles.tierBadge, { backgroundColor: TIER_COLOR[w.tier] }]}>
              <Text style={styles.tierLetter}>{agentTierLabel(w.tier)[0]}</Text>
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.tierTitle}>{agentTierLabel(w.tier)}</Text>
              <Text variant="note" tone="ink3">
                {w.tier === 'bronze'
                  ? 'Earnings clear after 24 hours. Silver means lower commission and instant earnings.'
                  : 'Lower commission, and errand earnings you can withdraw at once.'}
              </Text>
            </View>
          </View>
        </View>
      ) : null}

      <View style={{ gap: 4 }}>
        <Text variant="sec">Payout account</Text>
        <List>
          {account.data ? (
            <>
              <Row
                icon="bank"
                title={`${account.data.bankName} · ${account.data.accountNumber}`}
                subtitle={
                  account.data.inReview
                    ? `${account.data.accountName} · Support is checking it`
                    : account.data.accountName
                }
                onPress={() => router.push('/payout-account')}
              />
              {account.data.pending ? (
                <Row
                  icon="bank"
                  title={`${account.data.pending.bankName} · ${account.data.pending.accountNumber}`}
                  subtitle="New account. Support is checking it; withdrawals go to the one above meanwhile."
                  onPress={() => router.push('/payout-account')}
                />
              ) : null}
            </>
          ) : account.error ? (
            <Row
              icon="alert"
              title="Couldn't load your bank account"
              subtitle={account.error}
              onPress={() => account.reload()}
            />
          ) : account.loading ? (
            <Row icon="bank" title="Loading…" />
          ) : (
            <Row
              icon="bank"
              title="Add your bank account"
              subtitle="It must be in your own name"
              onPress={() => router.push('/payout-account')}
            />
          )}
        </List>
      </View>

      <View style={{ gap: 4 }}>
        <Text variant="sec">Withdrawals</Text>
        {withdrawals.data && withdrawals.data.length === 0 ? (
          <Empty icon="bank" title="No withdrawals yet" body="Free once a day, or instant for a small fee." />
        ) : null}
        <List>
          {withdrawals.data?.map((x) => (
            <Row
              key={x.id}
              icon={x.status === 'failed' ? 'history' : x.status === 'succeeded' ? 'check' : 'clock'}
              tone={x.status === 'succeeded' ? 'brand' : undefined}
              title={`${naira(x.sendKobo)} · ${STATUS[x.status]}`}
              subtitle={`${x.speed === 'instant' ? 'Instant' : 'Daily'} · ${shortWhen(x.createdAt)}${x.failureReason ? ` · ${x.failureReason}` : ''}`}
            />
          ))}
        </List>
      </View>
    </TabPage>
  );
}

const TIER_COLOR = { bronze: '#8C5A2B', silver: '#7A8088', gold: '#B8860B', platinum: '#4B5A6B' } as const;
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** "2026-11-13" as a local date at noon, safe from time-zone edges. */
const dayOf = (iso: string) => new Date(`${iso}T12:00:00`);
const fmtDay = (d: Date) => `${DAYS[d.getDay()]} ${d.getDate()} ${d.toLocaleDateString('en-GB', { month: 'short' })}`;

/**
 * Seven daily totals as bars: today in ink, the other days in a mid grey that stays visible against the
 * page. Only today and the best day carry their amount; tapping any bar shows its own.
 */
function WeekChart({ week }: { week: Array<{ date: string; earnedKobo: number }> }) {
  const c = useColors();
  const [picked, setPicked] = useState<number | null>(null);
  const max = Math.max(...week.map((d) => d.earnedKobo), 1);
  const best = week.reduce((b, d, i) => (d.earnedKobo > (week[b]?.earnedKobo ?? 0) ? i : b), 0);
  const today = week.length - 1;
  return (
    <View style={styles.chart} accessibilityLabel="Earnings for each of the last 7 days">
      {week.map((d, i) => {
        const day = DAYS[dayOf(d.date).getDay()]!;
        const shown = picked === i || ((i === today || i === best) && d.earnedKobo > 0 && picked === null);
        return (
          <Pressable
            key={d.date}
            accessibilityRole="button"
            accessibilityLabel={`${day}, ${naira(d.earnedKobo)}`}
            onPress={() => setPicked(picked === i ? null : i)}
            style={styles.barCol}
          >
            <Text style={[styles.barValue, { color: c.ink2, opacity: shown ? 1 : 0 }]} numberOfLines={1}>
              {naira(d.earnedKobo)}
            </Text>
            <View
              style={[
                styles.bar,
                {
                  height: d.earnedKobo ? Math.max(6, (d.earnedKobo / max) * CHART_HEIGHT) : 3,
                  backgroundColor: i === today ? c.ink : c.ink3,
                  opacity: picked === null || picked === i ? 1 : 0.45,
                },
              ]}
            />
            <Text style={[styles.barDay, { color: i === today ? c.ink : c.ink3 }]}>{day}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const CHART_HEIGHT = 120;

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', gap: 8 },
  total: {
    fontFamily: fonts.extrabold,
    fontSize: 40,
    lineHeight: 46,
    letterSpacing: -1.2,
    fontVariant: ['tabular-nums'],
  },
  chart: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingTop: 8 },
  barCol: { flex: 1, alignItems: 'center', gap: 6 },
  barValue: { fontFamily: fonts.bold, fontSize: 11, fontVariant: ['tabular-nums'] },
  bar: { width: '100%', maxWidth: 40, borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  barDay: { fontFamily: fonts.semibold, fontSize: 12 },
  withdraw: { borderRadius: 16, padding: 18, gap: 10 },
  withdrawLabel: { fontFamily: fonts.semibold, fontSize: 14, opacity: 0.8 },
  withdrawAmount: {
    fontFamily: fonts.extrabold,
    fontSize: 38,
    lineHeight: 42,
    letterSpacing: -1,
    fontVariant: ['tabular-nums'],
  },
  clears: { flexDirection: 'row', alignItems: 'center', gap: 8, borderTopWidth: 1, paddingTop: 12, marginTop: 4 },
  clearsAmount: { fontFamily: fonts.bold, fontSize: 15, fontVariant: ['tabular-nums'] },
  tier: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14 },
  tierBadge: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  tierLetter: { color: '#FFFFFF', fontFamily: fonts.bold, fontSize: 16 },
  tierTitle: { fontFamily: fonts.bold, fontSize: 16 },
});
