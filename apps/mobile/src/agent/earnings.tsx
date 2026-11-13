import { useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useResource } from '../api/useResource';
import { useRealtimeEvent } from '../realtime/realtime';
import { naira } from '../money';
import { useColors } from '../theme/theme';
import { space } from '../theme/tokens';
import { Button, Text } from '../ui/kit';
import { Card, Empty, Row, Section } from '../ui/parts';

interface AgentWallet {
  availableKobo: number;
  heldKobo: number;
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
}

const TIER_NAME = { bronze: 'Bronze', silver: 'Silver', gold: 'Gold', platinum: 'Platinum' } as const;
const STATUS = {
  requested: 'Queued',
  processing: 'On its way',
  succeeded: 'Paid',
  failed: 'Returned to balance',
} as const;

export function AgentEarnings() {
  const c = useColors();
  const wallet = useResource<AgentWallet>('/v1/wallet');
  const withdrawals = useResource<Withdrawal[]>('/v1/wallet/withdrawals');
  const account = useResource<PayoutAccount | null>('/v1/payout-account');
  const [refreshing, setRefreshing] = useState(false);
  const reloadSoon = () => {
    wallet.reloadSoon();
    withdrawals.reloadSoon();
  };
  useRealtimeEvent('wallet.updated', reloadSoon);
  useRealtimeEvent('errand.updated', reloadSoon);
  const w = wallet.data;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top']}>
      <ScrollView
        contentContainerStyle={{ padding: space.lg, gap: space.xl }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await Promise.all([wallet.reload(), withdrawals.reload(), account.reload()]);
              setRefreshing(false);
            }}
          />
        }
      >
        <Text variant="title">Earnings</Text>
        <Card>
          <Text variant="small" tone="ink3">
            Available to withdraw
          </Text>
          <Text variant="title" style={{ fontSize: 36, lineHeight: 42 }}>
            {w ? naira(w.availableKobo) : '…'}
          </Text>
          <Button label="Withdraw" disabled={!w || w.availableKobo <= 0} onPress={() => router.push('/withdraw')} />
          {w && w.heldKobo > 0 ? (
            <Text variant="small" tone="ink2">
              {naira(w.heldKobo)} clears soon ({TIER_NAME[w.tier]} earnings are held for 24 hours)
            </Text>
          ) : null}
        </Card>

        {w?.upcoming.length ? (
          <Section title="Clearing soon">
            {w.upcoming.map((u) => (
              <Row
                key={u.availableAt}
                icon="clock"
                title={naira(u.amountKobo)}
                subtitle={`Available ${new Date(u.availableAt).toLocaleString()}`}
              />
            ))}
          </Section>
        ) : null}

        <Section title="Payout account">
          {account.data ? (
            <Row
              icon="briefcase"
              title={`${account.data.bankName} · ${account.data.accountNumber}`}
              subtitle={account.data.accountName}
              onPress={() => router.push('/payout-account')}
            />
          ) : account.error ? (
            <Row
              icon="alert-circle"
              title="Couldn't load your bank account"
              subtitle={account.error}
              onPress={() => account.reload()}
            />
          ) : account.loading ? (
            <Row icon="briefcase" title="Loading…" />
          ) : (
            <Row
              icon="briefcase"
              title="Add your bank account"
              subtitle="It must be in your own name"
              onPress={() => router.push('/payout-account')}
            />
          )}
        </Section>

        <Section title="Withdrawals">
          {withdrawals.data && withdrawals.data.length === 0 ? (
            <Empty icon="send" title="No withdrawals yet" body="Free once a day, or instant for a small fee." />
          ) : null}
          <View>
            {withdrawals.data?.map((x) => (
              <Row
                key={x.id}
                icon={x.status === 'failed' ? 'rotate-ccw' : x.status === 'succeeded' ? 'check' : 'clock'}
                title={`${naira(x.sendKobo)} · ${STATUS[x.status]}`}
                subtitle={`${x.speed === 'instant' ? 'Instant' : 'Daily'} · ${new Date(x.createdAt).toLocaleString()}${x.failureReason ? ` · ${x.failureReason}` : ''}`}
              />
            ))}
          </View>
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}
