import { useState } from 'react';
import { Linking, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FEE_STEP_KOBO, type ErrandEvent } from '@jiffo/shared';
import { goBack } from '../nav';
import { useCountryConfig } from '../api/useCountryConfig';
import { distanceMeters } from '../location';
import { naira } from '../money';
import { useColors } from '../theme/theme';
import { fonts } from '../theme/tokens';
import { Button, Field, Text } from '../ui/kit';
import { Avatar, Badge, Chip, Icon, IconCircle, List, Row } from '../ui/parts';
import { Sheet } from '../ui/floating';
import { ModalSheet } from '../ui/modal-sheet';
import { JiffoMap } from '../ui/map/map';
import { StopMark } from '../ui/map/pins';
import type { MapPin } from '../ui/map/types';
import { Segments } from '../errands/progress';
import { stepTime } from '../errands/stage';
import { Lines, StageChip } from '../errands/trip';
import { stepsFor, type ErrandView } from '../errands/types';
import { km } from './board';
import { usePresence } from './presence';
import { agentStage } from './stage';

const PIN_KIND = { pickup: 'pick', stop: 'stop', dropoff: 'drop' } as const;

export interface AgentActions {
  can: (event: ErrandEvent) => boolean;
  act: (event: ErrandEvent, data?: Record<string, unknown>) => Promise<boolean>;
  busy: ErrandEvent | null;
  actionError: string | null;
}

/** Opens the phone's maps app with directions to a place. */
function directionsTo(lat: number, lng: number) {
  const url =
    Platform.OS === 'ios'
      ? `http://maps.apple.com/?daddr=${lat},${lng}`
      : `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
  void Linking.openURL(url);
}

/**
 * The agent's running job, after the prototype: a status card over the map, then the one thing to do
 * next (start, send the item amount, mark delivered, take the PIN), the job card and, on demand, the
 * progress, money and request.
 */
export function AgentTrip({ errand, actions }: { errand: ErrandView; actions: AgentActions }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { config } = useCountryConfig();
  const { coords } = usePresence();
  const [expanded, setExpanded] = useState(false);
  const [areaHeight, setAreaHeight] = useState(0);
  const [cardHeight, setCardHeight] = useState(0);
  const [sheetHeight, setSheetHeight] = useState(0);
  const [priceOpen, setPriceOpen] = useState(false);
  const [help, setHelp] = useState<'menu' | 'report' | null>(null);
  const { can, act, busy, actionError } = actions;

  const stage = agentStage(errand);
  const name = errand.customer?.firstName ?? 'The customer';
  const category = config?.categories.find((k) => k.key === errand.categoryKey);
  const pickup = errand.stops[0]!;
  const dropoff = errand.stops[errand.stops.length - 1]!;
  const routeMeters = errand.stops.slice(1).reduce((sum, s, i) => sum + distanceMeters(errand.stops[i]!, s), 0);
  const earns = errand.agentEarnsKobo ?? errand.feeKobo;
  // Before the items are bought (or the parcel collected), the agent heads to the pickup.
  const headingTo = ['accepted', 'started'].includes(errand.status) ? pickup : dropoff;
  const pins: MapPin[] = [
    ...errand.stops.map((s) => ({ key: String(s.seq), kind: PIN_KIND[s.kind], lat: s.lat, lng: s.lng })),
    ...(coords ? [{ key: 'me', kind: 'me' as const, ...coords }] : []),
  ];
  const openChat = () => router.push(`/errand/${errand.id}/chat`);
  const top = insets.top + 10;

  return (
    <View style={[styles.fill, { backgroundColor: c.bg }]} onLayout={(e) => setAreaHeight(e.nativeEvent.layout.height)}>
      <JiffoMap pins={pins} showRoute insets={{ top: top + cardHeight + 20, bottom: sheetHeight + 16 }} />

      <View
        onLayout={(e) => setCardHeight(e.nativeEvent.layout.height)}
        accessibilityLiveRegion="polite"
        style={[styles.tcard, { top, backgroundColor: c.surface, boxShadow: '0 10px 30px rgba(0,0,0,0.16)' }]}
      >
        <View style={styles.tcrow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to the board"
            onPress={goBack}
            style={styles.ib}
          >
            <Icon name="down" size={24} />
          </Pressable>
          <View style={{ flex: 1 }} />
          <View
            style={[styles.pillbtn, { backgroundColor: c.brandSoft }]}
            accessibilityLabel={`You earn ${naira(earns)}`}
          >
            <Icon name="wallet" size={16} color={c.brandInk} />
            <Text style={[styles.pillText, { color: c.brandInk }]}>{naira(earns)}</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Help with this errand"
            onPress={() => setHelp('menu')}
            style={[styles.pillbtn, { backgroundColor: c.surface2 }]}
          >
            <Text style={styles.pillText}>Help</Text>
          </Pressable>
        </View>
        <StageChip label={stage.chip.label} tone={stage.chip.tone} />
        <Text style={styles.tbig} accessibilityRole="header">
          {stage.big}
        </Text>
        {stage.sub ? (
          <Text variant="sub" tone="ink3" style={{ marginTop: -2 }}>
            {stage.sub}
          </Text>
        ) : null}
        <Segments step={stage.step} thick />
        <View style={[styles.tagent, { borderTopColor: c.line }]}>
          <Avatar name={name} size={42} />
          <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
            <Text style={styles.agentName} numberOfLines={1}>
              {name}
            </Text>
            <Text variant="note" tone="ink3" numberOfLines={1}>
              {stage.doing}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Chat with ${name}`}
            onPress={openChat}
            style={[styles.cbtn, { backgroundColor: c.surface2 }]}
          >
            <Icon name="chat" size={20} />
          </Pressable>
        </View>
      </View>

      <Sheet
        onHeight={setSheetHeight}
        onHandlePress={() => setExpanded((x) => !x)}
        handleLabel={expanded ? 'Show more map' : 'Show more details'}
        maxHeight={expanded && areaHeight ? areaHeight - top - cardHeight - 24 : undefined}
      >
        <NextStep errand={errand} actions={actions} onNewPrice={() => setPriceOpen(true)} />
        {actionError ? (
          <Text tone="danger" accessibilityLiveRegion="polite">
            {actionError}
          </Text>
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${pickup.label ?? 'Pickup'} to ${dropoff.label ?? 'drop-off'}, you earn ${naira(earns)}. Details`}
          onPress={() => setExpanded(true)}
          style={[styles.errcard, { borderColor: c.line2, backgroundColor: c.surface }]}
        >
          <View style={[styles.tile, { backgroundColor: c.surface2 }]}>
            <Icon name={category?.icon ?? 'bag'} size={20} />
          </View>
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Text style={styles.errTitle} numberOfLines={1}>
              {pickup.label ?? pickup.address} to {dropoff.label ?? dropoff.address}
            </Text>
            <Text variant="note" tone="ink3" numberOfLines={1}>
              {[category?.name, errand.buy ? 'you buy items' : 'no purchase', km(routeMeters)]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          </View>
          <View style={styles.held}>
            <Text style={styles.heldAmount}>{naira(earns)}</Text>
            <Text variant="note" tone="ink3">
              you earn
            </Text>
          </View>
        </Pressable>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          <Chip label="Directions" icon="nav" onPress={() => directionsTo(headingTo.lat, headingTo.lng)} />
          <Chip label={expanded ? 'Less' : 'Details'} icon="doc" onPress={() => setExpanded((x) => !x)} />
          {can('open_dispute') ? <Chip label="Report" icon="flag" onPress={() => setHelp('report')} /> : null}
        </ScrollView>

        {expanded ? (
          <>
            <View style={[styles.divider, { backgroundColor: c.bg2 }]} />
            <View style={styles.block}>
              <Text variant="sec" accessibilityRole="header">
                Progress
              </Text>
              <Timeline errand={errand} step={stage.step} />
            </View>
            <View style={styles.block}>
              <Text variant="sec" accessibilityRole="header">
                Your money
              </Text>
              <Lines
                rows={[
                  ['Errand fee', naira(errand.feeKobo)],
                  ['Commission', `−${naira(errand.feeKobo - earns)}`],
                ]}
                total={['You earn', naira(earns)]}
              />
              <Text variant="note" tone="ink3">
                {errand.buy
                  ? 'Item money you spend is paid back to you at hand-off, withdrawable at once.'
                  : 'Paid when the customer gives you their PIN or approves your drop-off photo.'}
              </Text>
            </View>
            <View style={styles.block}>
              <Text variant="sec" accessibilityRole="header">
                Errand
              </Text>
              <Text>{errand.description}</Text>
              <List>
                {errand.stops.map((s) => (
                  <Row
                    key={s.seq}
                    iconNode={
                      <IconCircle>
                        <StopMark kind={PIN_KIND[s.kind]} />
                      </IconCircle>
                    }
                    title={s.label ?? s.address}
                    subtitle={s.label ? s.address : null}
                    right={<Chip label="Go" icon="nav" onPress={() => directionsTo(s.lat, s.lng)} />}
                  />
                ))}
              </List>
            </View>
            {can('withdraw') ? (
              <List>
                <Row
                  icon="x"
                  tone="danger"
                  title="Leave this errand"
                  subtitle="It goes back to other agents"
                  onPress={() => act('withdraw')}
                  disabled={!!busy}
                />
              </List>
            ) : null}
          </>
        ) : null}
      </Sheet>

      <NewPriceSheet
        visible={priceOpen}
        onClose={() => setPriceOpen(false)}
        errand={errand}
        minFeeKobo={config?.settings.pricing.minFeeKobo ?? FEE_STEP_KOBO}
        onSend={async (amountKobo) => {
          if (await act('send_offer', { amountKobo })) setPriceOpen(false);
        }}
        sending={busy === 'send_offer'}
        error={actionError}
      />
      <HelpSheet
        mode={help}
        onMode={setHelp}
        onClose={() => setHelp(null)}
        errand={errand}
        actions={actions}
        onChat={() => {
          setHelp(null);
          openChat();
        }}
        onDirections={() => directionsTo(headingTo.lat, headingTo.lng)}
      />
    </View>
  );
}

/** The one thing to do next, as a big button, or what the agent is waiting for. */
function NextStep({
  errand,
  actions,
  onNewPrice,
}: {
  errand: ErrandView;
  actions: AgentActions;
  onNewPrice: () => void;
}) {
  const c = useColors();
  const { can, act, busy } = actions;
  const name = errand.customer?.firstName ?? 'the customer';
  const waiting = (icon: string, title: string, sub: string) => (
    <View style={[styles.waiting, { backgroundColor: c.surface2 }]}>
      <IconCircle icon={icon} />
      <View style={{ flex: 1 }}>
        <Text style={styles.waitTitle}>{title}</Text>
        <Text variant="note" tone="ink3">
          {sub}
        </Text>
      </View>
    </View>
  );

  if (errand.status === 'accepted' && errand.pendingOfferKobo !== null) {
    return (
      <View style={[styles.waiting, { backgroundColor: c.urgentSoft }]}>
        <IconCircle icon="edit" tone="urgent" />
        <View style={{ flex: 1 }}>
          <Text style={styles.waitTitle}>You sent a new price: {naira(errand.pendingOfferKobo)}</Text>
          <Text variant="note" tone="ink2">
            Was {naira(errand.feeKobo)}. You can start once {name} answers.
          </Text>
        </View>
        <Badge label="Pending" tone="urgent" />
      </View>
    );
  }
  if (can('start')) {
    return (
      <View style={styles.row2}>
        {can('send_offer') ? (
          <Button
            kind="secondary"
            label="New price"
            icon={<Icon name="edit" size={18} />}
            onPress={onNewPrice}
            style={styles.half}
          />
        ) : null}
        <Button
          label="Start service"
          icon={<Icon name="play" size={18} color={c.onInk} />}
          onPress={() => act('start')}
          loading={busy === 'start'}
          style={styles.half}
        />
      </View>
    );
  }
  if (can('send_item_amount')) {
    return (
      <View style={{ gap: 8 }}>
        <Button
          label="Send item amount"
          icon={<Icon name="camera" size={19} color={c.onInk} />}
          onPress={() => router.push(`/errand/${errand.id}/items`)}
        />
        <Text variant="note" tone="ink3" style={{ textAlign: 'center' }}>
          After paying, add the receipt and a photo of the items.
        </Text>
      </View>
    );
  }
  if (can('mark_delivered')) {
    return (
      <Button
        label="Mark delivered"
        icon={<Icon name="check" size={19} color={c.onInk} />}
        onPress={() => act('mark_delivered')}
        loading={busy === 'mark_delivered'}
      />
    );
  }
  if (can('confirm_pin')) {
    return (
      <View style={{ gap: 8 }}>
        <Button
          label={`Enter ${name}'s PIN`}
          icon={<Icon name="lock" size={19} color={c.onInk} />}
          onPress={() => router.push(`/errand/${errand.id}/handoff`)}
        />
        <View style={styles.row2}>
          {can('send_dropoff_photo') ? (
            <Button
              kind="secondary"
              label="Drop-off photo"
              icon={<Icon name="camera" size={18} />}
              onPress={() => router.push(`/errand/${errand.id}/dropoff`)}
              style={styles.half}
            />
          ) : null}
          {can('report_unreachable') ? (
            <Button
              kind="secondary"
              label="Not answering"
              icon={<Icon name="clock" size={18} />}
              onPress={() => act('report_unreachable')}
              loading={busy === 'report_unreachable'}
              style={styles.half}
            />
          ) : null}
        </View>
      </View>
    );
  }
  if (errand.status === 'item_pending') {
    return waiting(
      'bag',
      `Waiting for ${name} to lock ${naira(errand.itemAmountKobo ?? 0)}`,
      'They check your photos first',
    );
  }
  if (errand.status === 'photo_pending') {
    return waiting('camera', `Waiting for ${name} to approve your photo`, 'It approves itself in 24 hours');
  }
  if (errand.status === 'unreachable') {
    return waiting('clock', `Waiting for ${name} to answer`, 'They can ask for redelivery within 24 hours');
  }
  if (errand.status === 'disputed') {
    return waiting('shield', 'Support is reviewing', 'Answer them in the chat if they ask');
  }
  return null;
}

/** The five steps with a line between, done ones ticked, as on the customer's tracker. */
function Timeline({ errand, step }: { errand: ErrandView; step: number }) {
  const c = useColors();
  const steps = stepsFor(errand.buy);
  const notes = [
    'Price agreed in chat',
    'Price fixed',
    errand.buy ? 'Item amount locked' : 'On the way',
    'PIN or photo',
    'Paid to you',
  ];
  return (
    <View>
      {steps.map((title, k) => {
        const done = k < step;
        const now = k === step;
        return (
          <View key={title} style={styles.tlRow}>
            {k < steps.length - 1 ? (
              <View style={[styles.tlLine, { backgroundColor: done ? c.ink : c.line2 }]} />
            ) : null}
            <View
              style={[
                styles.tlDot,
                { borderColor: done || now ? c.ink : c.line2, backgroundColor: done ? c.ink : c.surface },
              ]}
            >
              {done ? <Icon name="check" size={12} weight={3.2} color={c.onInk} /> : null}
              {now ? <View style={[styles.tlNow, { backgroundColor: c.ink }]} /> : null}
            </View>
            <View style={{ flex: 1, gap: 1 }}>
              <Text style={styles.tlTitle}>{title}</Text>
              <Text variant="note" tone="ink3">
                {notes[k]}
              </Text>
            </View>
            <Text variant="note" tone="ink3">
              {k <= step ? stepTime(errand, k) : ''}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

/** "Send a new price": the fee in ₦100 steps, and what the agent would keep. */
function NewPriceSheet({
  visible,
  onClose,
  errand,
  minFeeKobo,
  onSend,
  sending,
  error,
}: {
  visible: boolean;
  onClose: () => void;
  errand: ErrandView;
  minFeeKobo: number;
  onSend: (amountKobo: number) => void;
  sending: boolean;
  error: string | null;
}) {
  const c = useColors();
  const [amount, setAmount] = useState(errand.feeKobo + 5 * FEE_STEP_KOBO);
  const name = errand.customer?.firstName ?? 'The customer';
  // Commission is a share of the fee, so what the agent keeps scales with the new price.
  const keeps = errand.agentEarnsKobo ? Math.round((amount * errand.agentEarnsKobo) / errand.feeKobo) : null;
  return (
    <ModalSheet visible={visible} onClose={onClose} label="Send a new price">
      <View style={{ gap: 6 }}>
        <Text variant="heading">Send a new price</Text>
        <Text variant="small" tone="ink2">
          Agreed now: {naira(errand.feeKobo)}. {name} sees it and accepts or declines. You can send new prices until you
          tap Start service.
        </Text>
      </View>
      <View style={styles.stepper}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Lower by ₦100"
          disabled={amount - FEE_STEP_KOBO < minFeeKobo}
          onPress={() => setAmount((a) => a - FEE_STEP_KOBO)}
          style={[
            styles.step,
            { backgroundColor: c.surface2, opacity: amount - FEE_STEP_KOBO < minFeeKobo ? 0.35 : 1 },
          ]}
        >
          <Icon name="minus" />
        </Pressable>
        <Text style={styles.newPrice} accessibilityLiveRegion="polite">
          {naira(amount)}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Raise by ₦100"
          onPress={() => setAmount((a) => a + FEE_STEP_KOBO)}
          style={[styles.step, { backgroundColor: c.surface2 }]}
        >
          <Icon name="plus" />
        </Pressable>
      </View>
      {keeps !== null ? (
        <Text variant="note" tone="ink3" style={{ textAlign: 'center', marginTop: -6 }}>
          You&apos;d earn {naira(keeps)} after commission
        </Text>
      ) : null}
      {error ? <Text tone="danger">{error}</Text> : null}
      <Button
        label={`Send ${naira(amount)}`}
        disabled={amount === errand.feeKobo}
        loading={sending}
        onPress={() => onSend(amount)}
      />
    </ModalSheet>
  );
}

/** Help: message the customer, directions, leave the errand before starting, or report a problem. */
function HelpSheet({
  mode,
  onMode,
  onClose,
  errand,
  actions,
  onChat,
  onDirections,
}: {
  mode: 'menu' | 'report' | null;
  onMode: (m: 'menu' | 'report') => void;
  onClose: () => void;
  errand: ErrandView;
  actions: AgentActions;
  onChat: () => void;
  onDirections: () => void;
}) {
  const [reason, setReason] = useState('');
  const { can, act, busy, actionError } = actions;
  const name = errand.customer?.firstName ?? 'the customer';
  const run = async (event: ErrandEvent, data?: Record<string, unknown>) => {
    if (await act(event, data)) {
      setReason('');
      onClose();
    }
  };
  return (
    <ModalSheet visible={!!mode} onClose={onClose} label={mode === 'report' ? 'Report a problem' : 'Help'}>
      {mode === 'report' ? (
        <>
          <View>
            <Text variant="heading">Report a problem</Text>
            <Text variant="sub" tone="ink3">
              Support looks at the chat, photos and your route. Your earnings stay held until they decide.
            </Text>
          </View>
          <Field label="What went wrong?" value={reason} onChangeText={setReason} multiline maxLength={500} />
          {actionError ? <Text tone="danger">{actionError}</Text> : null}
          <Button
            label="Send to support"
            disabled={reason.trim().length < 3}
            loading={busy === 'open_dispute'}
            onPress={() => run('open_dispute', { reason: reason.trim() })}
          />
        </>
      ) : (
        <>
          <Text variant="heading">Help with this errand</Text>
          <List>
            <Row icon="chat" title={`Message ${name}`} subtitle="Sort most things out in the chat" onPress={onChat} />
            <Row icon="nav" title="Directions" subtitle="Open your maps app" onPress={onDirections} />
            {can('open_dispute') ? (
              <Row icon="flag" title="Report a problem" subtitle="Support steps in" onPress={() => onMode('report')} />
            ) : null}
            {can('withdraw') ? (
              <Row
                icon="x"
                tone="danger"
                title="Leave this errand"
                subtitle="Before you start. It goes back to other agents."
                onPress={() => run('withdraw')}
                disabled={!!busy}
              />
            ) : null}
          </List>
          {actionError ? <Text tone="danger">{actionError}</Text> : null}
        </>
      )}
    </ModalSheet>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  tcard: {
    position: 'absolute',
    left: 10,
    right: 10,
    zIndex: 5,
    borderRadius: 22,
    paddingTop: 6,
    paddingHorizontal: 16,
    paddingBottom: 14,
    gap: 8,
  },
  tcrow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginLeft: -12, marginRight: -6 },
  ib: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  pillbtn: { height: 36, paddingHorizontal: 13, borderRadius: 999, flexDirection: 'row', alignItems: 'center', gap: 6 },
  pillText: { fontFamily: fonts.bold, fontSize: 14, fontVariant: ['tabular-nums'] },
  tbig: { fontFamily: fonts.extrabold, fontSize: 31, lineHeight: 34, letterSpacing: -0.87 },
  tagent: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6, paddingTop: 12, borderTopWidth: 1 },
  agentName: { fontFamily: fonts.bold, fontSize: 15.5 },
  cbtn: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  row2: { flexDirection: 'row', gap: 8 },
  half: { flex: 1, paddingHorizontal: 10 },
  waiting: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14 },
  waitTitle: { fontFamily: fonts.bold, fontSize: 15 },
  errcard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  tile: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  errTitle: { fontFamily: fonts.bold, fontSize: 15.5 },
  held: { alignItems: 'flex-end', gap: 1 },
  heldAmount: { fontFamily: fonts.bold, fontSize: 16, fontVariant: ['tabular-nums'] },
  chips: { flexDirection: 'row', gap: 8 },
  divider: { height: 8, marginHorizontal: -16 },
  block: { gap: 12 },
  tlRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingBottom: 16 },
  tlLine: { position: 'absolute', left: 10, top: 20, bottom: 0, width: 2 },
  tlDot: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  tlNow: { width: 10, height: 10, borderRadius: 5 },
  tlTitle: { fontFamily: fonts.bold, fontSize: 15 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  step: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  newPrice: {
    flex: 1,
    textAlign: 'center',
    fontFamily: fonts.extrabold,
    fontSize: 34,
    letterSpacing: -0.7,
    fontVariant: ['tabular-nums'],
  },
});
