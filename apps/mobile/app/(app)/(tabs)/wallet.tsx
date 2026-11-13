import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useResource } from '@/api/useResource';
import { VARIANT } from '@/config';
import { AgentEarnings } from '@/agent/earnings';
import { useRealtimeEvent } from '@/realtime/realtime';
import { naira } from '@/money';
import { useColors } from '@/theme/theme';
import { fonts } from '@/theme/tokens';
import { dayLabel } from '@/errands/when';
import { Button, Text } from '@/ui/kit';
import { Empty, Icon, List, Row } from '@/ui/parts';
import { ModalSheet } from '@/ui/modal-sheet';
import { TabPage } from '@/ui/tab-page';

interface Movement {
  id: number;
  amountKobo: number;
  kind: string;
  label: string;
  errandId: string | null;
  /** What the errand was for. */
  detail: string | null;
  createdAt: string;
}

export default function WalletTab() {
  return VARIANT === 'agent' ? <AgentEarnings /> : <Wallet />;
}

interface CustomerWallet {
  balanceKobo: number;
  heldKobo: number;
  holding: Array<{ errandId: string; description: string; heldKobo: number }>;
}

/** An icon for each kind of movement, as in the prototype's list. */
const KIND_ICON: Record<string, string> = {
  deposit: 'bank',
  fee_lock: 'lock',
  fee_adjust: 'lock',
  items_lock: 'lock',
  fee_refund: 'receipt',
  items_refund: 'receipt',
  settle: 'bag',
  tip: 'gift',
};

/** The customer's wallet: the errand balance, what's available and held, and movements by day. */
function Wallet() {
  const c = useColors();
  const wallet = useResource<CustomerWallet>('/v1/wallet');
  const history = useResource<Movement[]>('/v1/wallet/transactions?limit=50');
  const [refreshing, setRefreshing] = useState(false);
  const [howOpen, setHowOpen] = useState(false);
  const refresh = async () => {
    setRefreshing(true);
    await Promise.all([wallet.reload(), history.reload()]);
    setRefreshing(false);
  };
  const reloadSoon = () => {
    wallet.reloadSoon();
    history.reloadSoon();
  };
  useRealtimeEvent('wallet.updated', reloadSoon);
  useRealtimeEvent('errand.updated', reloadSoon);

  const w = wallet.data;
  const holding = w?.holding ?? [];
  const days: Array<{ day: string; rows: Movement[] }> = [];
  for (const m of history.data ?? []) {
    const day = dayLabel(new Date(m.createdAt));
    const last = days[days.length - 1];
    if (last?.day === day) last.rows.push(m);
    else days.push({ day, rows: [m] });
  }

  return (
    <TabPage title="Wallet" refreshing={refreshing} onRefresh={refresh} gap={18}>
      <View
        style={styles.wbal}
        accessibilityLabel={`Errand balance, ${w ? naira(w.balanceKobo + w.heldKobo) : 'loading'}`}
      >
        <Text style={[styles.wbalLabel, { color: c.ink3 }]}>Errand balance</Text>
        <Text style={styles.wbalNum}>{w ? naira(w.balanceKobo + w.heldKobo) : '…'}</Text>
      </View>

      <View style={[styles.wbreak, { borderColor: c.line2 }]}>
        <View style={styles.wrow}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.wrowTitle}>Available to spend</Text>
            <Text variant="note" tone="ink3">
              Used when an agent accepts your errand
            </Text>
          </View>
          <Text style={styles.wrowAmt}>{w ? naira(w.balanceKobo) : '…'}</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: !holding.length }}
          disabled={!holding.length}
          onPress={() => router.push(holding.length === 1 ? `/errand/${holding[0]!.errandId}` : '/errands')}
          style={[styles.wrow, { borderTopColor: c.line, borderTopWidth: 1 }]}
        >
          <View style={{ flex: 1, gap: 2 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Icon name="lock" size={15} />
              <Text style={styles.wrowTitle}>Held until hand-off</Text>
            </View>
            <Text variant="note" tone="ink3" numberOfLines={1}>
              {holding.length === 0
                ? 'Nothing is held right now'
                : holding.length === 1
                  ? `${holding[0]!.description} · tap to open it`
                  : `${holding.length} errands · tap to see them`}
            </Text>
          </View>
          <Text style={styles.wrowAmt}>{w ? naira(w.heldKobo) : '…'}</Text>
          {holding.length ? <Icon name="chev" size={16} color={c.ink3} /> : null}
        </Pressable>
        <Button kind="secondary" label="How your balance works" onPress={() => setHowOpen(true)} style={styles.how} />
      </View>

      <Button
        label="Add money"
        icon={<Icon name="plus" size={20} color={c.onInk} />}
        onPress={() => router.push('/topup')}
      />

      <View style={[styles.divider, { backgroundColor: c.bg2 }]} />

      <View style={{ gap: 4 }}>
        <Text variant="sec" accessibilityRole="header">
          Latest transactions
        </Text>
        {history.data && history.data.length === 0 ? (
          <Empty
            icon="wallet"
            title="No transactions yet"
            body="Money you add by bank transfer, and what each errand costs, shows here."
          />
        ) : null}
        {days.map((d) => (
          <View key={d.day}>
            <Text style={[styles.tday, { color: c.ink3 }]}>{d.day}</Text>
            <List inset={58}>
              {d.rows.map((m) => (
                <TxRow key={m.id} m={m} />
              ))}
            </List>
          </View>
        ))}
      </View>

      <View style={styles.wfoot}>
        <Icon name="info" size={16} color={c.ink3} />
        <Text variant="note" tone="ink3" style={{ flex: 1 }}>
          Your balance is for errands and can&apos;t be withdrawn. If you close your account, support refunds
          what&apos;s left.
        </Text>
      </View>

      <ModalSheet visible={howOpen} onClose={() => setHowOpen(false)} label="How your balance works">
        <Text variant="heading">How your balance works</Text>
        <List>
          <Row
            icon="bank"
            title="Add money by bank transfer"
            subtitle="To an account number made for you, from any bank app"
            subtitleLines={3}
          />
          <Row
            icon="lock"
            title="Held while your errand runs"
            subtitle="The fee is held when an agent accepts; item money when you lock the amount"
            subtitleLines={3}
          />
          <Row
            icon="check"
            tone="brand"
            title="Paid only at hand-off"
            subtitle="Your PIN, or your approval of a drop-off photo, releases it to the agent"
            subtitleLines={3}
          />
          <Row
            icon="receipt"
            title="Cancelled errands come straight back"
            subtitle="Anything held for an errand that doesn't finish returns to your balance"
            subtitleLines={3}
          />
        </List>
        <Text variant="note" tone="ink3">
          Your balance can&apos;t be withdrawn. If you close your account, support refunds what&apos;s left.
        </Text>
        <Button label="Got it" onPress={() => setHowOpen(false)} />
      </ModalSheet>
    </TabPage>
  );
}

/** .txrow: what moved, for which errand, and the amount, green when money came in. */
function TxRow({ m }: { m: Movement }) {
  const c = useColors();
  const isIn = m.amountKobo > 0;
  const time = new Date(m.createdAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return (
    <Row
      iconNode={
        <View style={[styles.txTile, { backgroundColor: isIn ? c.brandSoft : c.surface2 }]}>
          <Icon name={KIND_ICON[m.kind] ?? 'wallet'} size={19} color={isIn ? c.brandInk : c.ink} />
        </View>
      }
      title={m.label}
      subtitle={m.detail ? `${m.detail} · ${time}` : time}
      right={
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Text style={[styles.wamt, { color: isIn ? c.brandInk : c.ink }]}>
            {`${isIn ? '+' : '−'}${naira(Math.abs(m.amountKobo))}`}
          </Text>
          {m.errandId ? <Icon name="chev" size={16} color={c.ink3} /> : null}
        </View>
      }
      onPress={m.errandId ? () => router.push(`/errand/${m.errandId}`) : undefined}
    />
  );
}

const styles = StyleSheet.create({
  wbal: { alignItems: 'center', gap: 2, paddingTop: 2 },
  wbalLabel: { fontFamily: fonts.semibold, fontSize: 14 },
  wbalNum: {
    fontFamily: fonts.extrabold,
    fontSize: 52,
    lineHeight: 58,
    letterSpacing: -1.8,
    fontVariant: ['tabular-nums'],
  },
  wbreak: { borderWidth: 1, borderRadius: 16, paddingTop: 4, paddingHorizontal: 14, paddingBottom: 14 },
  wrow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 64, paddingVertical: 8 },
  wrowTitle: { fontFamily: fonts.semibold, fontSize: 15.5 },
  wrowAmt: { fontFamily: fonts.bold, fontSize: 16.5, fontVariant: ['tabular-nums'] },
  how: { marginTop: 4, minHeight: 44 },
  divider: { height: 8, marginHorizontal: -16 },
  tday: { marginTop: 12, fontFamily: fonts.bold, fontSize: 13 },
  txTile: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  wamt: { fontFamily: fonts.bold, fontSize: 15.5, fontVariant: ['tabular-nums'] },
  wfoot: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
});
