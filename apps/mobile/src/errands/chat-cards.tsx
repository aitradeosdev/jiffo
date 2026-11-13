import { useState, type ReactNode } from 'react';
import { Image, Modal, Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { naira } from '@/money';
import { useColors } from '@/theme/theme';
import { fonts } from '@/theme/tokens';
import { Button, Field, Text } from '@/ui/kit';
import { Badge, Icon } from '@/ui/parts';
import { Lines, PinBody, type ErrandActions } from './trip';
import type { ErrandView } from './types';

/**
 * The cards the customer acts on in the chat, after the prototype: a new price, the item amount, the
 * hand-off PIN and the drop-off photo. Each shows only while the errand is waiting on it.
 */
export function CustomerCards({
  errand,
  pin,
  actions,
  shortKobo,
  onAsk,
}: {
  errand: ErrandView;
  pin: string | null;
  actions: ErrandActions;
  shortKobo: number | null;
  /** "Ask in chat": puts the cursor in the message box. */
  onAsk: () => void;
}) {
  const { can } = actions;
  return (
    <View style={{ gap: 14 }}>
      {errand.pendingOfferKobo !== null && can('accept_offer') ? <OfferCard errand={errand} actions={actions} /> : null}
      {can('lock_item_amount') && errand.itemAmountKobo !== null ? (
        <ItemCard errand={errand} actions={actions} onAsk={onAsk} />
      ) : null}
      {errand.status === 'delivered' && pin ? <PinCard errand={errand} pin={pin} /> : null}
      {can('approve_photo') ? <PhotoCard errand={errand} actions={actions} /> : null}
      {actions.actionError ? (
        <Text tone="danger" accessibilityLiveRegion="polite">
          {actions.actionError}
        </Text>
      ) : null}
      {/* A new price or the item amount the wallet can't cover: offer the top-up it needs. */}
      {shortKobo && shortKobo > 0 ? (
        <Button
          label={`Add ${naira(shortKobo)} to your wallet`}
          onPress={() => router.push({ pathname: '/topup', params: { amount: String(shortKobo) } })}
        />
      ) : null}
    </View>
  );
}

function CardShell({ children, media }: { children: ReactNode; media?: ReactNode }) {
  const c = useColors();
  return (
    <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.line2 }]}>
      {media}
      <View style={styles.cpad}>{children}</View>
    </View>
  );
}

function CardHead({
  icon,
  tone,
  title,
  sub,
  right,
}: {
  icon?: string;
  tone?: 'brand' | 'urgent';
  title: string;
  sub: string;
  right?: ReactNode;
}) {
  const c = useColors();
  const bg = tone === 'brand' ? c.brandSoft : tone === 'urgent' ? c.urgentSoft : c.surface2;
  const fg = tone === 'brand' ? c.brandInk : tone === 'urgent' ? c.urgent : c.ink;
  return (
    <View style={styles.chead}>
      {icon ? (
        <View style={[styles.tile, { backgroundColor: bg }]}>
          <Icon name={icon} size={18} color={fg} />
        </View>
      ) : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.cheadTitle}>{title}</Text>
        <Text variant="note" tone="ink3">
          {sub}
        </Text>
      </View>
      {right}
    </View>
  );
}

function OfferCard({ errand, actions }: { errand: ErrandView; actions: ErrandActions }) {
  const c = useColors();
  const amount = errand.pendingOfferKobo!;
  // From the API, under the settings this errand was created with, so it matches what accepting holds.
  const service = errand.pendingOfferServiceFeeKobo ?? null;
  const { act, busy } = actions;
  return (
    <CardShell>
      <CardHead
        icon="edit"
        tone="urgent"
        title="New price"
        sub="Errand fee · allowed until Start service"
        right={<Badge label="Pending" tone="urgent" />}
      />
      <View style={styles.amtRow}>
        <Text style={styles.amt}>{naira(amount)}</Text>
        <Text style={[styles.was, { color: c.ink3 }]}>{naira(errand.feeKobo)}</Text>
      </View>
      {service !== null ? (
        <Text variant="note" tone="ink3">
          The service fee becomes {naira(service)}, so {naira(amount + service)} would be held. Declining keeps{' '}
          {errand.agent?.firstName ?? 'your agent'} at {naira(errand.feeKobo)}.
        </Text>
      ) : null}
      <View style={styles.row2}>
        <Button
          kind="secondary"
          label="Decline"
          onPress={() => act('decline_offer')}
          loading={busy === 'decline_offer'}
          disabled={!!busy}
          style={styles.half}
        />
        <Button
          label={`Accept ${naira(amount)}`}
          onPress={() => act('accept_offer')}
          loading={busy === 'accept_offer'}
          disabled={!!busy}
          style={styles.half}
        />
      </View>
    </CardShell>
  );
}

function ItemCard({ errand, actions, onAsk }: { errand: ErrandView; actions: ErrandActions; onAsk: () => void }) {
  const c = useColors();
  const amount = errand.itemAmountKobo!;
  const photos = errand.photos?.items ?? [];
  const { act, busy } = actions;
  return (
    <CardShell>
      <CardHead
        icon="bag"
        tone="brand"
        title="Item amount"
        sub="Receipt and photo attached · paid at hand-off"
        right={<Badge label="Pending" tone="urgent" />}
      />
      {photos.length ? (
        <View style={styles.pics}>
          {photos.slice(0, 4).map((url, i) => (
            <Photo key={url} url={url} stamp={i === 0 ? 'Receipt' : 'Items'} icon={i === 0 ? 'receipt' : 'camera'} />
          ))}
        </View>
      ) : null}
      <Lines rows={[]} total={['Receipt total', naira(amount)]} />
      <Text variant="note" tone="ink3">
        Check the photos match your list. Locking holds this amount until hand-off; nothing is paid to the agent before
        then.
      </Text>
      <View style={styles.row2}>
        <Button kind="secondary" label="Ask in chat" onPress={onAsk} style={styles.half} />
        <Button
          kind="brand"
          label={`Lock ${naira(amount)}`}
          icon={<Icon name="lock" size={17} color={c.onBrand} />}
          onPress={() => act('lock_item_amount')}
          loading={busy === 'lock_item_amount'}
          style={styles.half}
        />
      </View>
    </CardShell>
  );
}

function PinCard({ errand, pin }: { errand: ErrandView; pin: string }) {
  const [shown, setShown] = useState(false);
  return (
    <CardShell>
      <View style={{ alignItems: 'flex-end', marginBottom: -12 }}>
        <Button
          kind="secondary"
          small
          label={shown ? 'Hide' : 'Show'}
          icon={<Icon name={shown ? 'eyeoff' : 'eye'} size={16} />}
          onPress={() => setShown((x) => !x)}
        />
      </View>
      <PinBody errand={errand} pin={pin} hidden={!shown} />
      <Text variant="note" tone="ink3">
        Not home? Ask for a no-contact drop-off here in the chat.
      </Text>
    </CardShell>
  );
}

function PhotoCard({ errand, actions }: { errand: ErrandView; actions: ErrandActions }) {
  const [disputing, setDisputing] = useState(false);
  const [reason, setReason] = useState('');
  const { act, busy } = actions;
  const url = errand.photos?.dropoff;
  return (
    <CardShell media={url ? <Photo url={url} stamp="Drop-off photo" icon="pin" wide /> : undefined}>
      <CardHead
        title="No-contact drop-off"
        sub="Taken in the app at your drop-off"
        right={<Badge label="Pending" tone="urgent" />}
      />
      <Text variant="note" tone="ink3">
        Nothing is paid until you approve. If you don&apos;t respond, it approves itself in 24 hours.
      </Text>
      {disputing ? (
        <>
          <Field
            label="What's wrong?"
            value={reason}
            onChangeText={setReason}
            multiline
            maxLength={500}
            placeholder="For example: this isn't my gate"
          />
          <View style={styles.row2}>
            <Button kind="secondary" label="Back" onPress={() => setDisputing(false)} style={styles.half} />
            <Button
              kind="danger"
              label="Open dispute"
              disabled={reason.trim().length < 3}
              loading={busy === 'open_dispute'}
              onPress={() => act('open_dispute', { reason: reason.trim() })}
              style={styles.half}
            />
          </View>
        </>
      ) : (
        <View style={styles.row2}>
          <Button kind="secondary" label="Dispute" onPress={() => setDisputing(true)} style={styles.half} />
          <Button
            label="Approve"
            onPress={() => act('approve_photo')}
            loading={busy === 'approve_photo'}
            style={styles.half}
          />
        </View>
      )}
    </CardShell>
  );
}

/** A photo with a dark caption strip, as on the prototype's cards; tap to see it full screen. */
function Photo({ url, stamp, icon, wide }: { url: string; stamp: string; icon: string; wide?: boolean }) {
  const c = useColors();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable
        accessibilityRole="imagebutton"
        accessibilityLabel={`${stamp}. Open`}
        onPress={() => setOpen(true)}
        style={[wide ? styles.wide : styles.ph, { backgroundColor: c.surface2 }]}
      >
        <Image source={{ uri: url }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        <View style={styles.stamp}>
          <Icon name={icon} size={12} color="#FFFFFF" />
          <Text style={styles.stampText} numberOfLines={1}>
            {stamp}
          </Text>
        </View>
      </Pressable>
      {open ? <FullPhoto url={url} label={stamp} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function FullPhoto({ url, label, onClose }: { url: string; label: string; onClose: () => void }) {
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close photo"
          onPress={onClose}
          style={styles.close}
          hitSlop={12}
        >
          <Icon name="x" size={28} color="#FFFFFF" />
        </Pressable>
        <Image source={{ uri: url }} style={styles.full} resizeMode="contain" accessibilityLabel={label} />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 16, overflow: 'hidden' },
  cpad: { padding: 14, gap: 12 },
  chead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  tile: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  cheadTitle: { fontFamily: fonts.bold, fontSize: 16 },
  amtRow: { flexDirection: 'row', alignItems: 'baseline', gap: 10 },
  amt: {
    fontFamily: fonts.extrabold,
    fontSize: 34,
    lineHeight: 36,
    letterSpacing: -0.68,
    fontVariant: ['tabular-nums'],
  },
  was: { fontSize: 15, textDecorationLine: 'line-through' },
  row2: { flexDirection: 'row', gap: 8 },
  half: { flex: 1, paddingHorizontal: 10 },
  pics: { flexDirection: 'row', gap: 8 },
  ph: { flex: 1, aspectRatio: 4 / 5, borderRadius: 12, overflow: 'hidden' },
  wide: { height: 180, overflow: 'hidden' },
  stamp: {
    position: 'absolute',
    left: 8,
    right: 8,
    bottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.66)',
  },
  stampText: { color: '#FFFFFF', fontFamily: fonts.semibold, fontSize: 11 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center' },
  close: { position: 'absolute', top: 48, right: 20, zIndex: 1 },
  full: { width: '100%', height: '80%' },
});
