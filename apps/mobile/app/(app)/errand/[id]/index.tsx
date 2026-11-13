import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import type { ErrandEvent } from '@jiffo/shared';
import { useSession } from '@/auth/session';
import { errorMessage } from '@/api/client';
import { useResource } from '@/api/useResource';
import { useErrandSubscription, useRealtimeEvent } from '@/realtime/realtime';
import { STATUS_TEXT, type ErrandView } from '@/errands/types';
import { naira } from '@/money';
import { space } from '@/theme/tokens';
import { Button, Screen, Text } from '@/ui/kit';
import { Card, Chip, Icon, Row } from '@/ui/parts';
import { Photos } from '@/ui/photos';
import { AfterCompletion } from '@/errands/after-completion';

const SUBTEXT: Partial<Record<ErrandView['status'], string>> = {
  requested: 'Nearby agents can see it and accept. Nothing is held until one does.',
  accepted: 'Your agent can still propose a new price until they start.',
  started: 'The fee is now fixed.',
  item_pending: 'Check the receipt and photos, then lock the amount. It is paid only at hand-off.',
  items_locked: 'Your agent is on the way to the drop-off.',
  delivered: 'Give your PIN to the agent once you have everything.',
  photo_pending: 'Nothing is paid until you approve, or 24 hours pass.',
  unreachable: 'Arrange redelivery within 24 hours.',
  disputed: 'Support will contact you. The money stays held until they decide.',
};

/** The customer's view of one errand. Its actions come from the server's allowedEvents. */
export default function ErrandScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api } = useSession();
  const { data: errand, error, reload, setData } = useResource<ErrandView>(id ? `/v1/errands/${id}` : null);
  const [busy, setBusy] = useState<ErrandEvent | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pin, setPin] = useState<string | null>(null);
  useErrandSubscription(id);
  // The same update arrives on the errand's room and the customer's own room: reload once per new version.
  useRealtimeEvent<{ errandId: string; version: number }>('errand.updated', (u) => {
    if (u.errandId === id && (!errand || u.version > errand.version)) reload();
  });

  // The hand-off PIN only exists once the agent marks the errand delivered.
  useEffect(() => {
    if (errand?.status !== 'delivered') return setPin(null);
    api
      .get<{ pin: string }>(`/v1/errands/${errand.id}/pin`)
      .then((r) => setPin(r.pin))
      .catch(() => setPin(null));
  }, [api, errand?.id, errand?.status]);

  if (!errand) {
    return <Screen>{error ? <Text tone="danger">{error}</Text> : <ActivityIndicator />}</Screen>;
  }

  const can = (e: ErrandEvent) => errand.allowedEvents.includes(e);
  const act = async (event: ErrandEvent) => {
    setBusy(event);
    setActionError(null);
    try {
      setData(await api.post<ErrandView>(`/v1/errands/${errand.id}/events`, { event, version: errand.version }));
    } catch (e) {
      setActionError(errorMessage(e));
      reload();
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/home'))}
          hitSlop={12}
        >
          <Icon name="arrow-left" size={24} />
        </Pressable>
        <Text variant="heading" accessibilityLiveRegion="polite">
          {STATUS_TEXT[errand.status]}
        </Text>
      </View>
      {SUBTEXT[errand.status] ? <Text tone="ink2">{SUBTEXT[errand.status]}</Text> : null}

      {pin ? (
        <Card tone="brand">
          <Text variant="small" tone="ink2">
            Your hand-off PIN
          </Text>
          <Text variant="title" style={{ letterSpacing: 10 }} accessibilityLabel={`PIN ${pin.split('').join(' ')}`}>
            {pin}
          </Text>
          <Text variant="small" tone="ink2">
            Only share it when you have everything. It releases the payment.
          </Text>
        </Card>
      ) : null}

      {errand.pendingOfferKobo !== null && can('accept_offer') ? (
        <Card tone="urgent">
          <Text variant="label">
            New price from {errand.agent?.firstName ?? 'your agent'}: {naira(errand.pendingOfferKobo)}
          </Text>
          <Text variant="small" tone="ink2">
            Was {naira(errand.feeKobo)}. Decline to keep the old price, or get a new agent.
          </Text>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <Button
              label="Accept"
              onPress={() => act('accept_offer')}
              loading={busy === 'accept_offer'}
              style={{ flex: 1 }}
            />
            <Button
              kind="secondary"
              label="Decline"
              onPress={() => act('decline_offer')}
              loading={busy === 'decline_offer'}
              style={{ flex: 1 }}
            />
          </View>
        </Card>
      ) : null}

      {can('lock_item_amount') && errand.itemAmountKobo !== null ? (
        <Card tone="urgent">
          <Text variant="label">Lock {naira(errand.itemAmountKobo)} for your items</Text>
          <Photos urls={errand.photos?.items ?? []} label="Receipt and item photo" />
          <Text variant="small" tone="ink2">
            It's held separately and paid to your agent only at hand-off.
          </Text>
          <Button
            label={`Lock ${naira(errand.itemAmountKobo)}`}
            onPress={() => act('lock_item_amount')}
            loading={busy === 'lock_item_amount'}
          />
        </Card>
      ) : null}

      {can('approve_photo') ? (
        <Card tone="urgent">
          <Text variant="label">Your agent left the items at the drop-off</Text>
          <Photos urls={errand.photos?.dropoff ? [errand.photos.dropoff] : []} label="Drop-off photo" />
          <Button
            label="Approve the drop-off"
            onPress={() => act('approve_photo')}
            loading={busy === 'approve_photo'}
          />
        </Card>
      ) : null}

      {errand.agent ? (
        <Row
          icon="user"
          title={errand.agent.firstName ?? 'Your agent'}
          subtitle="Your agent"
          right={
            errand.status !== 'requested' ? (
              <Chip label="Message" icon="message-circle" onPress={() => router.push(`/errand/${errand.id}/chat`)} />
            ) : null
          }
        />
      ) : null}

      {errand.status === 'completed' ? <AfterCompletion errand={errand} onDone={reload} /> : null}

      <View>
        {errand.stops.map((s) => (
          <Row
            key={s.seq}
            icon={s.kind === 'dropoff' ? 'flag' : 'map-pin'}
            title={s.label ?? s.address}
            subtitle={s.label ? s.address : null}
          />
        ))}
      </View>
      <Text tone="ink2">{errand.description}</Text>

      <View style={{ gap: space.xs }}>
        <Text>
          Errand fee {naira(errand.feeKobo)} · service fee {naira(errand.serviceFeeKobo)}
        </Text>
        {errand.itemAmountKobo !== null ? <Text>Items {naira(errand.itemAmountKobo)}</Text> : null}
      </View>

      {actionError ? (
        <Text tone="danger" accessibilityLiveRegion="polite">
          {actionError}
        </Text>
      ) : null}

      <View style={{ gap: space.sm }}>
        {can('redeliver') ? (
          <Button label="Ask for redelivery" onPress={() => act('redeliver')} loading={busy === 'redeliver'} />
        ) : null}
        {can('release_agent') ? (
          <Button
            kind="secondary"
            label="Get a new agent"
            onPress={() => act('release_agent')}
            loading={busy === 'release_agent'}
          />
        ) : null}
        {can('cancel') ? (
          <Button kind="plain" label="Cancel errand" onPress={() => act('cancel')} loading={busy === 'cancel'} />
        ) : null}
      </View>
    </Screen>
  );
}
