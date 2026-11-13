import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { FEE_STEP_KOBO, serviceFee } from '@jiffo/shared';
import { useSession } from '@/auth/session';
import { errorMessage } from '@/api/client';
import { useCountryConfig } from '@/api/useCountryConfig';
import { useResource } from '@/api/useResource';
import { draftStops, useDraft } from '@/errands/draft';
import type { ErrandView, Quote } from '@/errands/types';
import { naira } from '@/money';
import { useColors } from '@/theme/theme';
import { radius, space } from '@/theme/tokens';
import { Button, Screen, Text } from '@/ui/kit';
import { Card, Icon, Row } from '@/ui/parts';

export default function Review() {
  const c = useColors();
  const { api } = useSession();
  const { config } = useCountryConfig();
  const { draft, update, reset } = useDraft();
  const wallet = useResource<{ balanceKobo: number }>('/v1/wallet');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const stops = draftStops(draft);
  const category = config?.categories.find((k) => k.key === draft.categoryKey);
  const buy = draft.buy ?? category?.buyDefault ?? false;

  const points = JSON.stringify(stops.map(({ lat, lng }) => ({ lat, lng })));
  useEffect(() => {
    // The draft is cleared once the errand is sent, while this screen is still closing.
    if (JSON.parse(points).length < 2) return;
    setError(null);
    api
      .post<Quote>('/v1/errands/quote', { stops: JSON.parse(points) })
      .then(setQuote)
      .catch((e) => setError(errorMessage(e)));
  }, [api, points, attempt]);

  const back = (
    <View style={styles.head}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} hitSlop={12}>
        <Icon name="arrow-left" size={24} />
      </Pressable>
      <Text variant="heading">Confirm your errand</Text>
    </View>
  );

  if (!quote || !config) {
    return (
      <Screen footer={error ? <Button label="Try again" onPress={() => setAttempt((n) => n + 1)} /> : undefined}>
        {back}
        {error ? <Text tone="danger">{error}</Text> : <ActivityIndicator />}
      </Screen>
    );
  }

  const fee = draft.feeKobo ?? quote.suggestedFeeKobo;
  const service = serviceFee(fee, config.settings.fees);
  const held = fee + service;
  // Unknown until the wallet loads: never tell a funded customer they're short while it does.
  const balance = wallet.data?.balanceKobo ?? null;
  const short = balance === null ? 0 : Math.max(0, held - balance);
  const diff = fee - quote.suggestedFeeKobo;
  const stateCode = stops[0]?.stateCode ?? null;

  const request = async () => {
    if (!stateCode) return setError("Jiffo isn't available at this pickup yet");
    setBusy(true);
    setError(null);
    try {
      const errand = await api.post<ErrandView>('/v1/errands', {
        categoryKey: draft.categoryKey,
        stateCode,
        description: draft.description.trim(),
        buy,
        urgent: draft.urgent,
        feeKobo: fee,
        stops: stops.map((s) => ({ kind: s.kind, label: s.name, address: s.address, lat: s.lat, lng: s.lng })),
      });
      reset();
      router.dismissAll();
      router.replace(`/errand/${errand.id}`);
    } catch (e) {
      setError(errorMessage(e));
      wallet.reload();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      footer={
        balance === null ? (
          wallet.error ? (
            <Button label="Try again" onPress={() => wallet.reload()} />
          ) : (
            <Button label="Checking your wallet" loading />
          )
        ) : short > 0 ? (
          <Button
            label={`Add ${naira(short)} to continue`}
            onPress={() => router.push({ pathname: '/topup', params: { amount: String(short) } })}
          />
        ) : (
          <Button label={`Request agent · ${naira(held)}`} onPress={request} loading={busy} disabled={!stateCode} />
        )
      }
    >
      {back}
      <Text tone="ink2">
        {stops[0]?.name} to {stops[stops.length - 1]?.name} · {(quote.distanceMeters / 1000).toFixed(1)} km · about{' '}
        {Math.max(1, Math.round(quote.durationSeconds / 60))} min
      </Text>

      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ gap: 2 }}>
            <Text variant="label">Errand fee{draft.urgent ? ' · Urgent' : ''}</Text>
            <Text variant="small" tone="ink3">
              {diff === 0
                ? 'Suggested for this distance'
                : diff > 0
                  ? `${naira(diff)} above suggested`
                  : `${naira(-diff)} below suggested`}
            </Text>
          </View>
          <Text variant="title">{naira(fee)}</Text>
        </View>
        <View style={styles.stepper}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Lower the fee by ₦100"
            disabled={fee - FEE_STEP_KOBO < quote.minFeeKobo}
            onPress={() => update({ feeKobo: fee - FEE_STEP_KOBO })}
            style={[
              styles.step,
              { backgroundColor: c.surface3, opacity: fee - FEE_STEP_KOBO < quote.minFeeKobo ? 0.4 : 1 },
            ]}
          >
            <Icon name="minus" />
          </Pressable>
          <Text variant="small" tone="ink3" style={{ flex: 1, textAlign: 'center' }}>
            Adjust your offer in ₦100 steps
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Raise the fee by ₦100"
            onPress={() => update({ feeKobo: fee + FEE_STEP_KOBO })}
            style={[styles.step, { backgroundColor: c.surface3 }]}
          >
            <Icon name="plus" />
          </Pressable>
        </View>
      </Card>

      <View style={{ gap: space.sm }}>
        <Line label="Service fee" value={naira(service)} />
        <Line label="Held when an agent accepts" value={naira(held)} bold />
      </View>

      <Row
        icon="credit-card"
        title={balance === null ? 'Wallet' : `Wallet · ${naira(balance)}`}
        subtitle={
          balance === null
            ? (wallet.error ?? 'Checking your balance…')
            : short > 0
              ? `Top up ${naira(short)} to continue`
              : 'Covers this errand. Nothing is held until an agent accepts.'
        }
        tone={short > 0 ? 'danger' : undefined}
        onPress={() => router.push('/topup')}
      />
      {!stateCode ? <Text tone="danger">Jiffo isn't available at this pickup yet.</Text> : null}
      {error ? (
        <Text tone="danger" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </Screen>
  );
}

function Line({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      <Text variant={bold ? 'label' : 'body'} tone={bold ? 'ink' : 'ink2'}>
        {label}
      </Text>
      <Text variant={bold ? 'label' : 'body'}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  step: { width: 44, height: 44, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
});
