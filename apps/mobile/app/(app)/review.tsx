import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { goBack } from '@/nav';
import { FEE_STEP_KOBO, serviceFee } from '@jiffo/shared';
import { useSession } from '@/auth/session';
import { errorMessage } from '@/api/client';
import { useCountryConfig } from '@/api/useCountryConfig';
import { useResource } from '@/api/useResource';
import { draftStops, useDraft } from '@/errands/draft';
import type { ErrandView, Quote } from '@/errands/types';
import { liveSchedule, staleSchedule, whenLabel } from '@/errands/when';
import { naira } from '@/money';
import { useColors } from '@/theme/theme';
import { fonts } from '@/theme/tokens';
import { Button, Text } from '@/ui/kit';
import { Badge, Icon, IconCircle, List } from '@/ui/parts';
import { CategoryArt } from '@/ui/category-art';
import { Fab, Sheet } from '@/ui/floating';
import { JiffoMap } from '@/ui/map/map';
import type { MapPin } from '@/ui/map/types';

const PIN_KIND = { pickup: 'pick', stop: 'stop', dropoff: 'drop' } as const;

export default function Review() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { api } = useSession();
  const { config } = useCountryConfig();
  const { draft, update, reset } = useDraft();
  const wallet = useResource<{ balanceKobo: number }>('/v1/wallet');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [sheetHeight, setSheetHeight] = useState(0);
  const stops = draftStops(draft);
  const category = config?.categories.find((k) => k.key === draft.categoryKey);
  const buy = draft.buy ?? category?.buyDefault ?? false;
  const schedule = liveSchedule(draft.scheduledFor);
  const stale = staleSchedule(draft.scheduledFor);
  // A chosen time can come too close while this screen is open: look again every half minute.
  const [, tick] = useState(0);
  useEffect(() => {
    if (!draft.scheduledFor) return;
    const timer = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(timer);
  }, [draft.scheduledFor]);
  const pins: MapPin[] = stops.map((s) => ({ key: s.kind, kind: PIN_KIND[s.kind], lat: s.lat, lng: s.lng }));

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

  const ready = quote && config;
  const fee = ready ? (draft.feeKobo ?? quote.suggestedFeeKobo) : 0;
  const service = ready ? serviceFee(fee, config.settings.fees) : 0;
  const held = fee + service;
  // Unknown until the wallet loads: never tell a funded customer they're short while it does.
  const balance = wallet.data?.balanceKobo ?? null;
  const short = balance === null ? 0 : Math.max(0, held - balance);
  const diff = quote ? fee - quote.suggestedFeeKobo : 0;
  const stateCode = stops[0]?.stateCode ?? null;
  const canLower = !!quote && fee - FEE_STEP_KOBO >= quote.minFeeKobo;

  const request = async () => {
    if (!stateCode) return setError("Jiffo isn't available at this pickup yet");
    // Checked again on tap: the time may have come too close since the screen last drew.
    if (staleSchedule(draft.scheduledFor)) return tick((n) => n + 1);
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
        ...(draft.scheduledFor ? { scheduledFor: draft.scheduledFor } : {}),
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

  const action = stale ? (
    <View style={{ gap: 8 }}>
      <Button label="Pick a new time" onPress={() => router.push('/when')} />
      <Button kind="plain" label="Send it now instead" onPress={() => update({ scheduledFor: null })} />
    </View>
  ) : balance === null ? (
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
    <Button
      label={`${schedule ? 'Schedule errand' : 'Request agent'} · ${naira(held)}`}
      onPress={request}
      loading={busy}
      disabled={!stateCode}
    />
  );

  return (
    <View style={[styles.fill, { backgroundColor: c.bg }]}>
      <JiffoMap pins={pins} showRoute insets={{ top: insets.top + 70, bottom: sheetHeight + 8 }} />
      <Fab icon="back" label="Back" onPress={goBack} style={{ top: insets.top + 14, left: 16 }} />
      <Sheet onHeight={setSheetHeight} maxHeight="66%">
        <View style={{ gap: 8 }}>
          <View>
            <Text variant="heading" accessibilityRole="header">
              Confirm your errand
            </Text>
            <Text variant="sub" tone="ink3" numberOfLines={2}>
              {stops[0]?.name} to {stops[stops.length - 1]?.name}
              {quote
                ? ` · ${(quote.distanceMeters / 1000).toFixed(1)} km · about ${Math.max(1, Math.round(quote.durationSeconds / 60))} min`
                : ''}
            </Text>
          </View>
          <View style={styles.badges}>
            {category ? <Badge icon={category.icon} label={category.name} /> : null}
            <Badge icon="bag" label={buy ? 'Agent buys items' : 'No purchase'} tone={buy ? 'brand' : undefined} />
            {schedule ? <Badge icon="cal" label={whenLabel(schedule)} /> : null}
            {stale ? <Badge icon="alert" label="Time passed" tone="urgent" /> : null}
          </View>
        </View>

        {!ready ? (
          error ? (
            <View style={{ gap: 12 }}>
              <Text tone="danger" accessibilityLiveRegion="polite">
                {error}
              </Text>
              <Button label="Try again" onPress={() => setAttempt((n) => n + 1)} />
            </View>
          ) : (
            <ActivityIndicator style={{ paddingVertical: 24 }} />
          )
        ) : (
          <>
            <View style={[styles.option, { borderColor: c.ink, backgroundColor: c.surface }]}>
              <View style={[styles.tile, { backgroundColor: c.surface2 }]}>
                <CategoryArt categoryKey={draft.categoryKey ?? ''} icon={category?.icon} size={44} />
              </View>
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Text style={styles.optionTitle}>Errand fee</Text>
                  {draft.urgent ? <Badge icon="zap" label="Urgent" tone="urgent" /> : null}
                </View>
                <Text variant="note" tone="ink3">
                  {diff === 0
                    ? 'Suggested for this distance'
                    : diff > 0
                      ? `${naira(diff)} above suggested`
                      : `${naira(-diff)} below suggested`}
                </Text>
              </View>
              <Text variant="price" accessibilityLiveRegion="polite">
                {naira(fee)}
              </Text>
            </View>

            <View style={styles.stepper}>
              <StepButton
                icon="minus"
                label="Lower the fee by ₦100"
                disabled={!canLower}
                onPress={() => update({ feeKobo: fee - FEE_STEP_KOBO })}
              />
              <Text variant="note" tone="ink3" style={{ flex: 1, textAlign: 'center' }}>
                Adjust your offer in ₦100 steps
              </Text>
              <StepButton
                icon="plus"
                label="Raise the fee by ₦100"
                onPress={() => update({ feeKobo: fee + FEE_STEP_KOBO })}
              />
            </View>

            <View style={styles.lines}>
              <Line label="Service fee" value={naira(service)} />
              <View style={[styles.tot, { borderTopColor: c.line }]}>
                <Line label="Held when an agent accepts" value={naira(held)} bold />
              </View>
            </View>

            <List>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={balance === null ? 'Wallet' : `Wallet, ${naira(balance)}`}
                onPress={() => router.push('/topup')}
                style={styles.payline}
              >
                <IconCircle icon="wallet" />
                <View style={{ flex: 1 }}>
                  <Text style={styles.paylineTitle}>{balance === null ? 'Wallet' : `Wallet · ${naira(balance)}`}</Text>
                  <Text
                    variant="note"
                    style={{
                      fontFamily: fonts.medium,
                      color: balance === null ? c.ink3 : short > 0 ? c.urgent : c.brandInk,
                    }}
                  >
                    {balance === null
                      ? (wallet.error ?? 'Checking your balance…')
                      : short > 0
                        ? `Top up ${naira(short)} to continue`
                        : 'Covers this errand'}
                  </Text>
                </View>
                <Icon name="chev" size={18} />
              </Pressable>
            </List>

            {stale ? (
              <Text tone="urgent" accessibilityLiveRegion="polite">
                The time you picked is less than 15 minutes away. Pick a new time, or send it now.
              </Text>
            ) : null}
            {!stateCode ? <Text tone="danger">Jiffo isn&apos;t available at this pickup yet.</Text> : null}
            {error ? (
              <Text tone="danger" accessibilityLiveRegion="polite">
                {error}
              </Text>
            ) : null}
            {action}
          </>
        )}
      </Sheet>
    </View>
  );
}

function StepButton({
  icon,
  label,
  onPress,
  disabled,
}: {
  icon: string;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.step,
        { backgroundColor: c.surface2, opacity: disabled ? 0.35 : 1, transform: [{ scale: pressed ? 0.9 : 1 }] },
      ]}
    >
      <Icon name={icon} />
    </Pressable>
  );
}

function Line({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  const c = useColors();
  const font = bold ? fonts.bold : fonts.regular;
  return (
    <View style={styles.line}>
      <Text style={{ fontFamily: font, fontSize: 15, color: bold ? c.ink : c.ink2 }}>{label}</Text>
      <Text style={{ fontFamily: font, fontSize: 15, color: c.ink, fontVariant: ['tabular-nums'] }}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  badges: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 2,
  },
  tile: { width: 52, height: 52, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  optionTitle: { fontFamily: fonts.bold, fontSize: 16 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  step: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  lines: { gap: 8 },
  line: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  tot: { borderTopWidth: 1, paddingTop: 10 },
  payline: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64, paddingVertical: 8 },
  paylineTitle: { fontFamily: fonts.semibold, fontSize: 15 },
});
