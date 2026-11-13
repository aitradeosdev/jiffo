import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ErrandEvent } from '@jiffo/shared';
import { goBack } from '@/nav';
import { useCountryConfig } from '@/api/useCountryConfig';
import { naira } from '@/money';
import { useColors } from '@/theme/theme';
import { fonts } from '@/theme/tokens';
import { Button, Field, Text } from '@/ui/kit';
import { Avatar, Chip, Icon, IconCircle, List, Row } from '@/ui/parts';
import { Sheet } from '@/ui/floating';
import { ModalSheet } from '@/ui/modal-sheet';
import { JiffoMap } from '@/ui/map/map';
import { StopMark } from '@/ui/map/pins';
import type { MapPin } from '@/ui/map/types';
import { customerNeeds, customerStage, heldKobo, stepTime, type StageTone } from './stage';
import { stepsFor, type ErrandView } from './types';

const PIN_KIND = { pickup: 'pick', stop: 'stop', dropoff: 'drop' } as const;

export interface ErrandActions {
  can: (event: ErrandEvent) => boolean;
  act: (event: ErrandEvent, data?: Record<string, unknown>) => Promise<boolean>;
  busy: ErrandEvent | null;
  actionError: string | null;
}

/**
 * The customer's live errand, after the prototype: a status card over the map, and a sheet with what
 * needs them, the errand, its progress and the money held. The sheet's handle shows more or less.
 */
export function CustomerTrip({
  errand,
  pin,
  actions,
}: {
  errand: ErrandView;
  pin: string | null;
  actions: ErrandActions;
}) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { config } = useCountryConfig();
  const [expanded, setExpanded] = useState(false);
  const [areaHeight, setAreaHeight] = useState(0);
  const [cardHeight, setCardHeight] = useState(0);
  const [sheetHeight, setSheetHeight] = useState(0);
  const [pinOpen, setPinOpen] = useState(false);
  const [help, setHelp] = useState<'menu' | 'report' | null>(null);
  const { can, act, busy, actionError } = actions;

  const stage = customerStage(errand);
  const needs = customerNeeds(errand);
  const agent = errand.agent?.firstName ?? 'Your agent';
  const category = config?.categories.find((k) => k.key === errand.categoryKey);
  const pickup = errand.stops.find((s) => s.kind === 'pickup');
  const dropoff = errand.stops.find((s) => s.kind === 'dropoff');
  const held = heldKobo(errand);
  const pins: MapPin[] = errand.stops.map((s) => ({
    key: String(s.seq),
    kind: PIN_KIND[s.kind],
    lat: s.lat,
    lng: s.lng,
  }));
  const openChat = () => router.push(`/errand/${errand.id}/chat`);
  const top = insets.top + 10;

  return (
    <View style={[styles.fill, { backgroundColor: c.bg }]} onLayout={(e) => setAreaHeight(e.nativeEvent.layout.height)}>
      <JiffoMap pins={pins} showRoute insets={{ top: top + cardHeight + 20, bottom: sheetHeight + 16 }} />

      <StatusCard
        errand={errand}
        stage={stage}
        top={top}
        onLayout={setCardHeight}
        onHelp={() => setHelp('menu')}
        onChat={openChat}
      />

      <Sheet
        onHeight={setSheetHeight}
        onHandlePress={() => setExpanded((x) => !x)}
        handleLabel={expanded ? 'Show more map' : 'Show more details'}
        maxHeight={expanded && areaHeight ? areaHeight - top - cardHeight - 24 : undefined}
      >
        {needs ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${needs.title}. ${needs.sub}`}
            onPress={openChat}
            style={[styles.needs, { backgroundColor: c.urgentSoft }]}
          >
            <IconCircle icon={needs.icon} tone="urgent" />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.needsTitle}>{needs.title}</Text>
              <Text variant="note" tone="ink2">
                {needs.sub}
              </Text>
            </View>
            <Icon name="chev" size={18} />
          </Pressable>
        ) : null}
        {errand.status === 'delivered' && pin ? (
          <Button
            label="Show hand-off PIN"
            icon={<Icon name="lock" size={19} color={c.onInk} />}
            onPress={() => setPinOpen(true)}
          />
        ) : null}
        {can('redeliver') ? (
          <Button label="Ask for redelivery" onPress={() => act('redeliver')} loading={busy === 'redeliver'} />
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${pickup?.label ?? 'Pickup'} to ${dropoff?.label ?? 'drop-off'}, ${naira(held)} held. Details`}
          onPress={() => setExpanded(true)}
          style={[styles.errcard, { borderColor: c.line2, backgroundColor: c.surface }]}
        >
          <View style={[styles.tile, { backgroundColor: c.surface2 }]}>
            <Icon name={category?.icon ?? 'bag'} size={20} />
          </View>
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Text style={styles.errTitle} numberOfLines={1}>
              {pickup?.label ?? pickup?.address} to {dropoff?.label ?? dropoff?.address}
            </Text>
            <Text variant="note" tone="ink3" numberOfLines={1}>
              {category?.name ?? 'Errand'} · {errand.buy ? 'agent buys items' : 'no purchase'}
            </Text>
          </View>
          <View style={styles.held}>
            <Text style={styles.heldAmount}>{naira(held)}</Text>
            <View style={styles.heldLabel}>
              <Icon name="lock" size={11} color={c.ink3} />
              <Text variant="note" tone="ink3">
                held
              </Text>
            </View>
          </View>
        </Pressable>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          <Chip label="Message" icon="chat" onPress={openChat} />
          <Chip label={expanded ? 'Less' : 'Details'} icon="doc" onPress={() => setExpanded((x) => !x)} />
          {can('open_dispute') ? <Chip label="Report" icon="flag" onPress={() => setHelp('report')} /> : null}
        </ScrollView>

        {actionError ? (
          <Text tone="danger" accessibilityLiveRegion="polite">
            {actionError}
          </Text>
        ) : null}

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
                Money held
              </Text>
              <Lines
                rows={[
                  ['Errand fee', naira(errand.feeKobo)],
                  ['Service fee', naira(errand.serviceFeeKobo)],
                  ...(errand.held?.itemsKobo ? ([['Items (locked)', naira(errand.held.itemsKobo)]] as const) : []),
                ]}
                total={['Held until hand-off', naira(held)]}
              />
              <Text variant="note" tone="ink3">
                {agent} is paid only when you give your PIN or approve the drop-off photo.
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
                  />
                ))}
              </List>
            </View>
            <List>
              {can('release_agent') ? (
                <Row
                  icon="users"
                  title="Get a new agent"
                  subtitle="Back to matching. No fee for you."
                  onPress={() => act('release_agent')}
                  disabled={!!busy}
                />
              ) : null}
              {can('cancel') ? (
                <Row
                  icon="x"
                  tone="danger"
                  title="Cancel errand"
                  subtitle="Everything held goes back to your wallet"
                  onPress={() => act('cancel')}
                  disabled={!!busy}
                />
              ) : null}
            </List>
          </>
        ) : null}
      </Sheet>

      <ModalSheet visible={pinOpen && !!pin} onClose={() => setPinOpen(false)} label="Your hand-off PIN">
        <PinBody errand={errand} pin={pin} />
        <Button label="Done" onPress={() => setPinOpen(false)} />
        <Button
          kind="plain"
          label={`Something's wrong? Message ${agent}`}
          onPress={() => {
            setPinOpen(false);
            openChat();
          }}
        />
      </ModalSheet>

      <HelpSheet
        mode={help}
        onClose={() => setHelp(null)}
        onMode={setHelp}
        errand={errand}
        actions={actions}
        onChat={() => {
          setHelp(null);
          openChat();
        }}
      />
    </View>
  );
}

/** .tcard: status chip, the big line, progress and the agent, floating at the top. */
function StatusCard({
  errand,
  stage,
  top,
  onLayout,
  onHelp,
  onChat,
}: {
  errand: ErrandView;
  stage: ReturnType<typeof customerStage>;
  top: number;
  onLayout: (h: number) => void;
  onHelp: () => void;
  onChat: () => void;
}) {
  const c = useColors();
  const name = errand.agent?.firstName ?? 'Your agent';
  return (
    <View
      onLayout={(e) => onLayout(e.nativeEvent.layout.height)}
      accessibilityLiveRegion="polite"
      style={[styles.tcard, { top, backgroundColor: c.surface, boxShadow: '0 10px 30px rgba(0,0,0,0.16)' }]}
    >
      <View style={styles.tcrow}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back to home" onPress={goBack} style={styles.ib}>
          <Icon name="down" size={24} />
        </Pressable>
        <View style={{ flex: 1 }} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Help with this errand"
          onPress={onHelp}
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
      <TBar step={stage.step} />
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
          onPress={onChat}
          style={[styles.cbtn, { backgroundColor: c.surface2 }]}
        >
          <Icon name="chat" size={20} />
        </Pressable>
      </View>
    </View>
  );
}

/** .tchip: the small coloured status label. */
export function StageChip({ label, tone }: { label: string; tone: StageTone }) {
  const c = useColors();
  const bg = tone === 'urgent' ? c.urgentSoft : tone === 'danger' ? c.dangerSoft : c.brandSoft;
  const fg = tone === 'urgent' ? c.urgent : tone === 'danger' ? c.danger : c.brandInk;
  return (
    <View style={[styles.tchip, { backgroundColor: bg }]}>
      {tone === 'brand' ? <View style={[styles.dot, { backgroundColor: fg }]} /> : null}
      <Text style={[styles.tchipText, { color: fg }]}>{label}</Text>
    </View>
  );
}

/** .tbar: the tracker's thicker five-step bar. */
function TBar({ step }: { step: number }) {
  const c = useColors();
  return (
    <View style={styles.tbar} accessibilityLabel={`Step ${Math.max(0, step) + 1} of 5`}>
      {[0, 1, 2, 3, 4].map((i) => (
        <View key={i} style={[styles.tbarSeg, { backgroundColor: i < step ? c.brand2 : c.surface3 }]}>
          {i === step ? <View style={[styles.tbarNow, { backgroundColor: c.brand2 }]} /> : null}
        </View>
      ))}
    </View>
  );
}

/** .tl: the five steps with a line between, done ones ticked, and the time each was reached. */
function Timeline({ errand, step }: { errand: ErrandView; step: number }) {
  const c = useColors();
  const steps = stepsFor(errand.buy);
  const notes = [
    'Price agreed in chat',
    'Price fixed',
    errand.buy ? 'Receipt checked' : 'Heading to drop-off',
    'PIN or photo',
    'Money released',
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
                {
                  borderColor: done || now ? c.ink : c.line2,
                  backgroundColor: done ? c.ink : c.surface,
                },
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

/** .lines: label and amount rows, with a bold total under a rule. */
export function Lines({
  rows,
  total,
}: {
  rows: ReadonlyArray<readonly [string, string]>;
  total?: readonly [string, string];
}) {
  const c = useColors();
  return (
    <View style={{ gap: 8 }}>
      {rows.map(([label, value]) => (
        <View key={label} style={styles.line}>
          <Text style={{ fontSize: 15, color: c.ink2 }}>{label}</Text>
          <Text style={styles.lineValue}>{value}</Text>
        </View>
      ))}
      {total ? (
        <View style={[styles.line, styles.tot, { borderTopColor: c.line }]}>
          <Text style={styles.totText}>{total[0]}</Text>
          <Text style={[styles.totText, { fontVariant: ['tabular-nums'] }]}>{total[1]}</Text>
        </View>
      ) : null}
    </View>
  );
}

/** The PIN in four big boxes, with what entering it pays. */
export function PinBody({ errand, pin, hidden }: { errand: ErrandView; pin: string | null; hidden?: boolean }) {
  const c = useColors();
  const name = errand.agent?.firstName ?? 'your agent';
  const items = errand.held?.itemsKobo ?? 0;
  return (
    <View style={{ gap: 16 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <IconCircle icon="lock" tone="ink" size={52} />
        <View style={{ flex: 1 }}>
          <Text variant="note" tone="ink3">
            {name} marked it delivered
          </Text>
          <Text variant="heading">Your hand-off PIN</Text>
        </View>
      </View>
      <View style={styles.pinRow} accessibilityLabel={hidden || !pin ? 'PIN hidden' : `PIN ${pin.split('').join(' ')}`}>
        {(pin ?? '••••').split('').map((d, k) => (
          <View key={k} style={[styles.pinBox, { backgroundColor: c.surface2 }]}>
            <Text style={styles.pinDigit}>{hidden ? '•' : d}</Text>
          </View>
        ))}
      </View>
      <Text variant="small" tone="ink3">
        Give it to {name} only when you have everything. Entering it pays {naira(errand.feeKobo)} for the errand
        {items ? ` and ${naira(items)} for the items` : ''}.
      </Text>
    </View>
  );
}

/** Help: message the agent, swap agents, cancel, or report a problem to support. */
function HelpSheet({
  mode,
  onClose,
  onMode,
  errand,
  actions,
  onChat,
}: {
  mode: 'menu' | 'report' | null;
  onClose: () => void;
  onMode: (m: 'menu' | 'report') => void;
  errand: ErrandView;
  actions: ErrandActions;
  onChat: () => void;
}) {
  const [reason, setReason] = useState('');
  const { can, act, busy, actionError } = actions;
  const name = errand.agent?.firstName ?? 'your agent';
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
              Support looks at the chat and photos. The money stays held until they decide.
            </Text>
          </View>
          <Field
            label="What went wrong?"
            value={reason}
            onChangeText={setReason}
            multiline
            maxLength={500}
            placeholder="For example: some items are missing"
          />
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
            {can('release_agent') ? (
              <Row
                icon="users"
                title="Get a new agent"
                subtitle="Back to matching. No fee for you."
                onPress={() => run('release_agent')}
                disabled={!!busy}
              />
            ) : null}
            {can('open_dispute') ? (
              <Row icon="flag" title="Report a problem" subtitle="Support steps in" onPress={() => onMode('report')} />
            ) : null}
            {can('cancel') ? (
              <Row
                icon="x"
                tone="danger"
                title="Cancel errand"
                subtitle="Everything held goes back to your wallet"
                onPress={() => run('cancel')}
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
  pillText: { fontFamily: fonts.bold, fontSize: 14 },
  tchip: {
    alignSelf: 'flex-start',
    height: 26,
    paddingHorizontal: 10,
    borderRadius: 7,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  tchipText: { fontFamily: fonts.bold, fontSize: 13 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  tbig: { fontFamily: fonts.extrabold, fontSize: 31, lineHeight: 34, letterSpacing: -0.87 },
  tbar: { flexDirection: 'row', gap: 5 },
  tbarSeg: { flex: 1, height: 7, borderRadius: 4, overflow: 'hidden' },
  tbarNow: { position: 'absolute', top: 0, bottom: 0, left: 0, width: '50%' },
  tagent: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6, paddingTop: 12, borderTopWidth: 1 },
  agentName: { fontFamily: fonts.bold, fontSize: 15.5 },
  cbtn: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  needs: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
  },
  needsTitle: { fontFamily: fonts.bold, fontSize: 15 },
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
  heldLabel: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  chips: { flexDirection: 'row', gap: 8 },
  divider: { height: 8, marginHorizontal: -16 },
  block: { gap: 12 },
  tlRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingBottom: 16 },
  tlLine: { position: 'absolute', left: 10, top: 20, bottom: 0, width: 2 },
  tlDot: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  tlNow: { width: 10, height: 10, borderRadius: 5 },
  tlTitle: { fontFamily: fonts.bold, fontSize: 15 },
  line: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  lineValue: { fontSize: 15, fontVariant: ['tabular-nums'] },
  tot: { borderTopWidth: 1, paddingTop: 10 },
  totText: { fontFamily: fonts.bold, fontSize: 15 },
  pinRow: { flexDirection: 'row', gap: 10 },
  pinBox: { flex: 1, height: 76, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  pinDigit: { fontFamily: fonts.extrabold, fontSize: 36 },
});
