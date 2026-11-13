import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { useSession } from '@/auth/session';
import { errorMessage } from '@/api/client';
import { useCountryConfig } from '@/api/useCountryConfig';
import { naira, parseNaira } from '@/money';
import { space } from '@/theme/tokens';
import { Button, Field, Screen, Text } from '@/ui/kit';
import { Card, Chip, Icon, Row } from '@/ui/parts';

interface Deposit {
  id: string;
  status: 'pending' | 'succeeded' | 'failed';
  expired: boolean;
  amountKobo: number;
  paidKobo: number | null;
  accountNumber: string;
  accountName: string;
  bankName: string;
  expiresAt: string;
}

const PRESETS = [200_000, 500_000, 1_000_000, 2_000_000];
const POLL_MS = 8_000;

/** Add money: choose an amount, transfer it to a one-time account number, and wait for it to land. */
export default function TopUp() {
  const { amount } = useLocalSearchParams<{ amount?: string }>();
  const { api } = useSession();
  const { config } = useCountryConfig();
  const min = config?.settings.wallet.minDepositKobo ?? 10_000;
  const max = config?.settings.wallet.maxDepositKobo ?? null;
  const suggested = amount ? Math.max(Number(amount), min) : null;
  const [text, setText] = useState(suggested ? String(Math.ceil(suggested / 100)) : '');
  const [deposit, setDeposit] = useState<Deposit | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const kobo = parseNaira(text);
  const valid = kobo !== null && kobo >= min && (max === null || kobo <= max);

  // While the account number is open, check every few seconds whether the transfer has landed.
  useEffect(() => {
    if (!deposit || deposit.status !== 'pending') return;
    const timer = setInterval(async () => {
      try {
        setDeposit(await api.get<Deposit>(`/v1/wallet/deposits/${deposit.id}`));
      } catch {
        // Keep showing the account number; the next check may get through.
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [api, deposit]);

  const start = async () => {
    if (!kobo) return;
    setBusy(true);
    setError(null);
    try {
      setDeposit(await api.post<Deposit>('/v1/wallet/deposits', { amountKobo: kobo }));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (deposit?.status === 'succeeded') {
    return (
      <Screen footer={<Button label="Done" onPress={() => router.back()} />}>
        <View style={{ alignItems: 'center', gap: space.md, paddingTop: space.xxl }}>
          <Icon name="check-circle" size={48} />
          <Text variant="title">{naira(deposit.paidKobo ?? deposit.amountKobo)} received</Text>
          <Text tone="ink2">It's in your wallet and ready for your next errand.</Text>
        </View>
      </Screen>
    );
  }

  if (deposit) {
    const copy = async () => {
      await Clipboard.setStringAsync(deposit.accountNumber);
      setCopied(true);
    };
    return (
      <Screen footer={<Button kind="secondary" label="I'll do it later" onPress={() => router.back()} />}>
        <Text variant="title">Transfer {naira(deposit.amountKobo)}</Text>
        <Text tone="ink2">
          Send exactly this amount from any bank app to the account below. It's for this top-up only.
        </Text>
        <Card>
          <Row
            title={deposit.accountNumber}
            subtitle="Account number"
            right={<Chip label={copied ? 'Copied' : 'Copy'} icon="copy" onPress={copy} />}
          />
          <Row title={deposit.bankName} subtitle="Bank" />
          <Row title={deposit.accountName} subtitle="Account name" />
        </Card>
        <Text variant="small" tone={deposit.expired ? 'danger' : 'ink3'} accessibilityLiveRegion="polite">
          {deposit.expired
            ? 'This account number has expired. If you already sent the money it will still reach your wallet.'
            : `Open until ${new Date(deposit.expiresAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}. We'll update this screen when the money lands.`}
        </Text>
      </Screen>
    );
  }

  return (
    <Screen footer={<Button label="Get account number" onPress={start} disabled={!valid} loading={busy} />}>
      <Text variant="title">Add money</Text>
      <Text tone="ink2">Pay by bank transfer. Your balance is for errands only.</Text>
      <Field
        label="Amount"
        prefix="₦"
        value={text}
        onChangeText={(t) => setText(t.replace(/[^\d.,]/g, ''))}
        keyboardType="decimal-pad"
        placeholder="5,000"
        autoFocus
        error={error ?? (text && !valid ? `Enter ${naira(min)} or more${max ? `, up to ${naira(max)}` : ''}` : null)}
      />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        {PRESETS.map((p) => (
          <Chip key={p} label={naira(p)} selected={kobo === p} onPress={() => setText(String(p / 100))} />
        ))}
      </View>
    </Screen>
  );
}
