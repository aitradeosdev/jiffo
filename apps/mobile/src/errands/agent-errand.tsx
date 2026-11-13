import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Image, Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { goBack } from '../nav';
import type { ErrandEvent } from '@jiffo/shared';
import { useSession } from '../auth/session';
import { errorMessage } from '../api/client';
import { pickPhoto, uploadPhoto, type UploadPurpose } from '../api/upload';
import { useResource } from '../api/useResource';
import { useCountryConfig } from '../api/useCountryConfig';
import { useErrandSubscription, useRealtimeEvent } from '../realtime/realtime';
import { naira, parseNaira } from '../money';
import { radius, space } from '../theme/tokens';
import { Button, Field, Screen, Text } from '../ui/kit';
import { Card, Chip, Icon, Row } from '../ui/parts';
import { Photos } from '../ui/photos';
import { AfterCompletion } from './after-completion';
import { AGENT_STATUS, type ErrandView } from './types';
import { AgentRequest } from '../agent/request';

interface Shot {
  uri: string;
  mimeType: string;
  purpose: UploadPurpose;
}

/** The agent's view of one errand. Every action comes from the server's allowedEvents. */
export function AgentErrand({ id }: { id: string }) {
  const { api } = useSession();
  const { config } = useCountryConfig();
  const { data: errand, error, reload, setData } = useResource<ErrandView>(id ? `/v1/errands/${id}` : null);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [offer, setOffer] = useState('');
  const [itemAmount, setItemAmount] = useState('');
  const [shots, setShots] = useState<Shot[]>([]);
  const [pin, setPin] = useState('');
  useErrandSubscription(id);
  useRealtimeEvent<{ errandId: string; version: number }>('errand.updated', (u) => {
    if (u.errandId === id && (!errand || u.version > errand.version)) reload();
  });

  // Photo links expire after 15 minutes: refresh every 10 while there are photos to show.
  const hasPhotos = !!errand?.photos && (errand.photos.items.length > 0 || !!errand.photos.dropoff);
  useEffect(() => {
    if (!hasPhotos) return;
    const timer = setInterval(reload, 10 * 60_000);
    return () => clearInterval(timer);
  }, [hasPhotos, reload]);

  if (!errand) return <Screen>{error ? <Text tone="danger">{error}</Text> : <ActivityIndicator />}</Screen>;

  const can = (e: ErrandEvent) => errand.allowedEvents.includes(e);
  const category = config?.categories.find((c) => c.key === errand.categoryKey);
  const act = async (event: ErrandEvent, data: Record<string, unknown> = {}, label: string = event) => {
    setBusy(label);
    setActionError(null);
    try {
      const next = await api.post<ErrandView>(`/v1/errands/${errand.id}/events`, {
        event,
        data,
        version: errand.version,
      });
      setData(next);
      return next;
    } catch (e) {
      setActionError(errorMessage(e));
      reload();
      return null;
    } finally {
      setBusy(null);
    }
  };

  const take = async (purpose: UploadPurpose) => {
    const file = await pickPhoto('camera');
    if (file)
      setShots((s) => [
        // One photo of each kind: taking it again replaces it.
        ...s.filter((x) => x.purpose !== purpose),
        { ...file, purpose },
      ]);
  };
  /** Uploads the photos for this step, then sends the event with their keys. */
  const sendWithPhotos = async (
    event: 'send_item_amount' | 'send_dropoff_photo',
    data: (keys: string[]) => Record<string, unknown>,
  ) => {
    const purposes: UploadPurpose[] = event === 'send_item_amount' ? ['receipt', 'item_photo'] : ['dropoff_photo'];
    const mine = shots.filter((s) => purposes.includes(s.purpose));
    setBusy(event);
    setActionError(null);
    try {
      const keys = await Promise.all(mine.map((s) => uploadPhoto(api, errand.id, s.purpose, s)));
      setBusy(null);
      if (await act(event, data(keys))) setShots((s) => s.filter((x) => !purposes.includes(x.purpose)));
    } catch (e) {
      setActionError(errorMessage(e));
      setBusy(null);
    }
  };

  if (errand.role === 'prospect') {
    return (
      <AgentRequest errand={errand} onAccept={() => act('accept')} accepting={busy === 'accept'} error={actionError} />
    );
  }

  const offerKobo = parseNaira(offer);
  const itemKobo = parseNaira(itemAmount);
  const hasReceipt = shots.some((s) => s.purpose === 'receipt');
  const hasItems = shots.some((s) => s.purpose === 'item_photo');
  const dropShot = shots.find((s) => s.purpose === 'dropoff_photo');

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={goBack} hitSlop={12}>
          <Icon name="arrow-left" size={24} />
        </Pressable>
        <Text variant="heading" accessibilityLiveRegion="polite" style={{ flex: 1 }}>
          {AGENT_STATUS[errand.status]}
        </Text>
      </View>

      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text variant="small" tone="ink3">
            {category?.name ?? errand.categoryKey}
            {errand.urgent ? ' · Urgent' : ''}
            {errand.buy ? ' · Buying items' : ''}
          </Text>
          <Text variant="title">{naira(errand.feeKobo)}</Text>
        </View>
        <Text>{errand.description}</Text>
        {errand.customer?.firstName ? (
          <Text variant="small" tone="ink3">
            For {errand.customer.firstName}
          </Text>
        ) : null}
      </Card>

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

      {errand.role === 'agent' && errand.status !== 'requested' ? (
        <Chip label="Message customer" icon="message-circle" onPress={() => router.push(`/errand/${errand.id}/chat`)} />
      ) : null}

      {can('accept') ? (
        <Button
          label={`Accept for ${naira(errand.feeKobo)}`}
          onPress={() => act('accept')}
          loading={busy === 'accept'}
        />
      ) : null}

      {errand.pendingOfferKobo !== null ? (
        <Card tone="urgent">
          <Text variant="label">You proposed {naira(errand.pendingOfferKobo)}</Text>
          <Text variant="small" tone="ink2">
            Waiting for the customer to accept or decline. You can start once they answer.
          </Text>
        </Card>
      ) : null}

      {can('send_offer') ? (
        <Section title="Propose a new price" note="You can change the price until you start the errand.">
          <Field
            label="New price"
            prefix="₦"
            value={offer}
            onChangeText={(t) => setOffer(t.replace(/[^\d.,]/g, ''))}
            keyboardType="decimal-pad"
          />
          <Button
            kind="secondary"
            label={offerKobo ? `Send ${naira(offerKobo)}` : 'Send new price'}
            disabled={!offerKobo}
            loading={busy === 'send_offer'}
            onPress={async () => {
              if (offerKobo && (await act('send_offer', { amountKobo: offerKobo }))) setOffer('');
            }}
          />
        </Section>
      ) : null}

      {can('start') ? <Button label="Start errand" onPress={() => act('start')} loading={busy === 'start'} /> : null}

      {can('send_item_amount') ? (
        <Section
          title="Send the item amount"
          note="Buy the items, then send what you paid with a photo of the receipt and of the items."
        >
          <Field
            label="Amount you paid"
            prefix="₦"
            value={itemAmount}
            onChangeText={(t) => setItemAmount(t.replace(/[^\d.,]/g, ''))}
            keyboardType="decimal-pad"
          />
          <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
            <Chip label={hasReceipt ? 'Receipt ✓' : 'Photo of receipt'} icon="camera" onPress={() => take('receipt')} />
            <Chip label={hasItems ? 'Items ✓' : 'Photo of items'} icon="camera" onPress={() => take('item_photo')} />
          </View>
          <Thumbs shots={shots.filter((s) => s.purpose !== 'dropoff_photo')} />
          <Button
            label={itemKobo ? `Send ${naira(itemKobo)}` : 'Send item amount'}
            disabled={!itemKobo || !hasReceipt || !hasItems}
            loading={busy === 'send_item_amount'}
            onPress={() => sendWithPhotos('send_item_amount', (photos) => ({ amountKobo: itemKobo, photos }))}
          />
        </Section>
      ) : null}

      {errand.status === 'item_pending' ? <Photos urls={errand.photos?.items ?? []} label="Item photo" /> : null}

      {can('mark_delivered') ? (
        <Button label="I'm at the drop-off" onPress={() => act('mark_delivered')} loading={busy === 'mark_delivered'} />
      ) : null}

      {can('confirm_pin') ? (
        <Section title="Hand over" note="Ask the customer for their 4-digit PIN once they have everything.">
          <Field
            label="Customer's PIN"
            value={pin}
            onChangeText={(t) => setPin(t.replace(/\D/g, '').slice(0, 4))}
            keyboardType="number-pad"
            maxLength={4}
            style={{ letterSpacing: 8, fontSize: 22 }}
          />
          <Button
            label="Confirm hand-off"
            disabled={pin.length !== 4}
            loading={busy === 'confirm_pin'}
            onPress={async () => {
              if (await act('confirm_pin', { pin })) setPin('');
            }}
          />
        </Section>
      ) : null}

      {can('send_dropoff_photo') ? (
        <Section
          title="Leave it at the drop-off"
          note="If the customer asked you to leave it, take a photo where you left it. They approve it to release payment."
        >
          {dropShot ? (
            <Image
              source={{ uri: dropShot.uri }}
              style={{ width: 160, height: 160, borderRadius: radius.md }}
              accessibilityLabel="Drop-off photo"
            />
          ) : null}
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <Button
              kind="secondary"
              label={dropShot ? 'Retake' : 'Take photo'}
              onPress={() => take('dropoff_photo')}
              style={{ flex: 1 }}
            />
            <Button
              label="Send photo"
              disabled={!dropShot}
              loading={busy === 'send_dropoff_photo'}
              onPress={() => sendWithPhotos('send_dropoff_photo', ([photo]) => ({ photo }))}
              style={{ flex: 1 }}
            />
          </View>
        </Section>
      ) : null}

      {can('report_unreachable') ? (
        <Button
          kind="plain"
          label="Customer unreachable"
          onPress={() => act('report_unreachable')}
          loading={busy === 'report_unreachable'}
        />
      ) : null}

      {actionError ? (
        <Text tone="danger" accessibilityLiveRegion="polite">
          {actionError}
        </Text>
      ) : null}

      {can('withdraw') ? (
        <Button
          kind="plain"
          label="Withdraw from this errand"
          onPress={() => act('withdraw')}
          loading={busy === 'withdraw'}
        />
      ) : null}

      {errand.status === 'completed' && errand.role === 'agent' ? (
        <AfterCompletion errand={errand} onDone={reload} />
      ) : null}
    </Screen>
  );
}

function Section({ title, note, children }: { title: string; note: string; children: ReactNode }) {
  return (
    <Card>
      <Text variant="label">{title}</Text>
      <Text variant="small" tone="ink2">
        {note}
      </Text>
      {children}
    </Card>
  );
}

function Thumbs({ shots }: { shots: Shot[] }) {
  if (shots.length === 0) return null;
  return (
    <View style={{ flexDirection: 'row', gap: space.sm }}>
      {shots.map((s) => (
        <Image
          key={s.uri}
          source={{ uri: s.uri }}
          style={{ width: 64, height: 64, borderRadius: radius.sm }}
          accessibilityLabel={s.purpose === 'receipt' ? 'Receipt photo' : 'Item photo'}
        />
      ))}
    </View>
  );
}
