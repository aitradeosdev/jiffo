import { useMemo, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { goBack } from '@/nav';
import { useSession } from '@/auth/session';
import { ApiError, errorMessage } from '@/api/client';
import { useResource } from '@/api/useResource';
import { Button, Field, Screen, Text } from '@/ui/kit';
import { Icon, Row } from '@/ui/parts';

interface Bank {
  code: string;
  name: string;
}

/** The agent's own-name bank account. The bank's name for it must match the agent's name on their NIN. */
export default function PayoutAccount() {
  const { api } = useSession();
  const banks = useResource<Bank[]>('/v1/banks');
  const [bank, setBank] = useState<Bank | null>(null);
  const [search, setSearch] = useState('');
  const [number, setNumber] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const matches = useMemo(
    () => (banks.data ?? []).filter((b) => b.name.toLowerCase().includes(search.trim().toLowerCase())).slice(0, 8),
    [banks.data, search],
  );

  const save = async () => {
    if (!bank) return;
    setBusy(true);
    setError(null);
    try {
      await api.put('/v1/payout-account', { bankCode: bank.code, accountNumber: number });
      goBack();
    } catch (e) {
      const held = e instanceof ApiError ? e.details.accountName : undefined;
      setError(
        typeof held === 'string'
          ? `The bank has this account as ${held}. It must be in your own name, as on your NIN.`
          : errorMessage(e),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      footer={<Button label="Save account" onPress={save} disabled={!bank || number.length !== 10} loading={busy} />}
    >
      <Text variant="title">Your bank account</Text>
      <Text tone="ink2">Payouts only go to an account in your own name.</Text>
      {bank ? (
        <Row
          icon="briefcase"
          title={bank.name}
          subtitle="Bank"
          right={<Icon name="check" />}
          onPress={() => setBank(null)}
        />
      ) : (
        <View>
          <Field label="Bank" value={search} onChangeText={setSearch} placeholder="Search banks" />
          {banks.loading && !banks.data ? <ActivityIndicator /> : null}
          {matches.map((b) => (
            <Row key={b.code} icon="briefcase" title={b.name} onPress={() => setBank(b)} />
          ))}
        </View>
      )}
      <Field
        label="Account number"
        value={number}
        onChangeText={(t) => setNumber(t.replace(/\D/g, '').slice(0, 10))}
        keyboardType="number-pad"
        maxLength={10}
        error={error}
      />
    </Screen>
  );
}
