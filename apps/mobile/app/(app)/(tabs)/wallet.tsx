import { useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useResource } from '@/api/useResource';
import { VARIANT } from '@/config';
import { AgentEarnings } from '@/agent/earnings';
import { useRealtimeEvent } from '@/realtime/realtime';
import { naira } from '@/money';
import { useColors } from '@/theme/theme';
import { space } from '@/theme/tokens';
import { Button, Text } from '@/ui/kit';
import { Card, Empty, Row, Section } from '@/ui/parts';

interface Movement {
  id: number;
  amountKobo: number;
  kind: string;
  label: string;
  errandId: string | null;
  createdAt: string;
}

export default function WalletTab() {
  return VARIANT === 'agent' ? <AgentEarnings /> : <Wallet />;
}

function Wallet() {
  const c = useColors();
  const wallet = useResource<{ balanceKobo: number }>('/v1/wallet');
  const history = useResource<Movement[]>('/v1/wallet/transactions?limit=50');
  const [refreshing, setRefreshing] = useState(false);
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

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top']}>
      <ScrollView
        contentContainerStyle={{ padding: space.lg, gap: space.xl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
      >
        <Text variant="title">Wallet</Text>
        <Card>
          <Text variant="small" tone="ink3">
            Available to spend
          </Text>
          <Text variant="title" style={{ fontSize: 36, lineHeight: 42 }}>
            {wallet.data ? naira(wallet.data.balanceKobo) : '…'}
          </Text>
          <Button label="Add money" onPress={() => router.push('/topup')} />
        </Card>
        <Section title="Latest transactions">
          {history.data && history.data.length === 0 ? (
            <Empty
              icon="credit-card"
              title="No transactions yet"
              body="Money you add by bank transfer, and what each errand costs, shows here."
            />
          ) : null}
          <View>
            {history.data?.map((m) => (
              <Row
                key={m.id}
                icon={m.amountKobo > 0 ? 'arrow-down-left' : 'arrow-up-right'}
                tone={m.amountKobo > 0 ? 'brand' : undefined}
                title={m.label}
                subtitle={new Date(m.createdAt).toLocaleString()}
                right={<Text variant="label">{`${m.amountKobo > 0 ? '+' : '−'}${naira(Math.abs(m.amountKobo))}`}</Text>}
                onPress={m.errandId ? () => router.push(`/errand/${m.errandId}`) : undefined}
              />
            ))}
          </View>
        </Section>
        <Text variant="small" tone="ink3">
          Your balance is for errands and can't be withdrawn. If you close your account, support refunds what's left.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
