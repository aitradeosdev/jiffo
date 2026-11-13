import { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { goBack } from '@/nav';
import { useSession } from '@/auth/session';
import { ApiError, errorMessage } from '@/api/client';
import { useResource } from '@/api/useResource';
import { naira, parseNaira } from '@/money';
import { space } from '@/theme/tokens';
import { Button, Field, Screen, Text } from '@/ui/kit';
import { Chip, Row } from '@/ui/parts';

/** Withdraw to the agent's own bank account: free once a day, or now for a small fee. */
export default function Withdraw() {
  const { api } = useSession();
  const wallet = useResource<{ availableKobo: number }>('/v1/wallet');
  const account = useResource<{ bankName: string; accountNumber: string } | null>('/v1/payout-account');
  const [text, setText] = useState('');
  const [speed, setSpeed] = useState<'scheduled' | 'instant'>('scheduled');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const kobo = parseNaira(text);
  const available = wallet.data?.availableKobo ?? 0;

  const submit = async () => {
    if (!kobo) return;
    setBusy(true);
    setError(null);
    try {
      await api.post('/v1/wallet/withdrawals', { amountKobo: kobo, speed });
      goBack();
    } catch (e) {
      const remaining = e instanceof ApiError ? e.details.remainingKobo : undefined;
      setError(
        typeof remaining === 'number'
          ? `${errorMessage(e)} You can withdraw ${naira(remaining)} more today.`
          : errorMessage(e),
      );
    } finally {
      setBusy(false);
    }
  };

  if (account.data === null) {
    return (
      <Screen footer={<Button label="Add bank account" onPress={() => router.replace('/payout-account')} />}>
        <Text variant="title">Add your bank account first</Text>
        <Text tone="ink2">Withdrawals go only to an account in your own name.</Text>
      </Screen>
    );
  }

  return (
    <Screen
      footer={
        <Button
          label={kobo ? `Withdraw ${naira(kobo)}` : 'Withdraw'}
          onPress={submit}
          disabled={!kobo || kobo > available}
          loading={busy}
        />
      }
    >
      <Text variant="title">Withdraw</Text>
      <Text tone="ink2">Available: {naira(available)}</Text>
      <Field
        label="Amount"
        prefix="₦"
        value={text}
        onChangeText={(t) => setText(t.replace(/[^\d.,]/g, ''))}
        keyboardType="decimal-pad"
        error={error ?? (kobo && kobo > available ? 'More than you have available' : null)}
      />
      <Chip label="Everything" onPress={() => setText(String(available / 100))} />
      <View style={{ gap: space.sm }}>
        <Row
          icon="calendar"
          title="Daily withdrawal · free"
          subtitle="Sent with the day's payouts"
          right={
            <Chip
              label={speed === 'scheduled' ? 'Selected' : 'Choose'}
              selected={speed === 'scheduled'}
              onPress={() => setSpeed('scheduled')}
            />
          }
        />
        <Row
          icon="zap"
          title="Instant · small fee"
          subtitle="Sent now; the fee is taken from the amount"
          right={
            <Chip
              label={speed === 'instant' ? 'Selected' : 'Choose'}
              selected={speed === 'instant'}
              onPress={() => setSpeed('instant')}
            />
          }
        />
      </View>
      {account.data ? (
        <Text variant="small" tone="ink3">
          To {account.data.bankName} · {account.data.accountNumber}
        </Text>
      ) : null}
    </Screen>
  );
}
