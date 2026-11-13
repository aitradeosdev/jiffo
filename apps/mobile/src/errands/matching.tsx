import { useState } from 'react';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { goBack } from '@/nav';
import { naira } from '@/money';
import { useColors } from '@/theme/theme';
import { Button, Text } from '@/ui/kit';
import { IconCircle, List, Row } from '@/ui/parts';
import { Fab, Sheet, Shimmer } from '@/ui/floating';
import { JiffoMap } from '@/ui/map/map';
import { StopMark } from '@/ui/map/pins';
import type { MapPin } from '@/ui/map/types';
import type { ErrandView } from './types';
import { upcoming, whenLabel } from './when';

const PIN_KIND = { pickup: 'pick', stop: 'stop', dropoff: 'drop' } as const;

/** The prototype's "+ ₦200" raise. */
const RAISE_STEP_KOBO = 20_000;

/** While an errand waits for an agent: the route on the map and a sheet that says what is happening. */
export function Matching({
  errand,
  onCancel,
  cancelling,
  onRaise,
  raising,
  shortKobo,
  error,
}: {
  errand: ErrandView;
  onCancel?: () => void;
  cancelling: boolean;
  onRaise?: (amountKobo: number) => void;
  raising: boolean;
  /** Set when a raise was refused for want of money: how much more the wallet needs. */
  shortKobo: number | null;
  error: string | null;
}) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const [sheetHeight, setSheetHeight] = useState(0);
  const pickup = errand.stops.find((s) => s.kind === 'pickup');
  const scheduled = upcoming(errand.scheduledFor);
  // Like the prototype: the map centres on the pickup, with rings while nearby agents are asked.
  const pins: MapPin[] = pickup
    ? [{ key: 'pickup', kind: 'pick', lat: pickup.lat, lng: pickup.lng, radar: !scheduled }]
    : [];

  const title = scheduled
    ? `Scheduled for ${whenLabel(scheduled)}`
    : errand.urgent
      ? 'Sending to the nearest agents'
      : 'Finding your agent';
  const sub = scheduled
    ? 'It goes on the board ahead of time, so an agent can accept it early.'
    : errand.urgent
      ? 'The first agent to accept gets it.'
      : `Agents near ${pickup?.label ?? 'your pickup'} can see it and accept.`;

  return (
    <View style={[styles.fill, { backgroundColor: c.bg }]}>
      <JiffoMap pins={pins} interactive={false} insets={{ top: insets.top + 70, bottom: sheetHeight }} />
      <Fab icon="back" label="Back to home" onPress={goBack} style={{ top: insets.top + 14, left: 16 }} />
      <Sheet onHeight={setSheetHeight} handle={false} top={scheduled ? null : <Shimmer />}>
        <View>
          <Text variant="heading" accessibilityRole="header" accessibilityLiveRegion="polite">
            {title}
          </Text>
          <Text variant="sub" tone="ink3">
            {sub}
          </Text>
        </View>
        <List>
          {errand.stops.map((stop) => (
            <Row
              key={stop.seq}
              iconNode={<MarkWell kind={PIN_KIND[stop.kind]} />}
              title={stop.label ?? stop.address}
              subtitle={stop.label ? stop.address : null}
            />
          ))}
          <Row icon="doc" title="Your request" subtitle={errand.description} subtitleLines={3} />
          <Row
            icon="wallet"
            title={`${naira(errand.feeKobo)} offer`}
            subtitle="Nothing is held until an agent accepts"
            right={
              onRaise ? (
                <Button
                  kind="secondary"
                  small
                  label={`+ ${naira(RAISE_STEP_KOBO)}`}
                  loading={raising}
                  onPress={() => onRaise(errand.feeKobo + RAISE_STEP_KOBO)}
                />
              ) : undefined
            }
          />
        </List>
        {error ? (
          <Text tone="danger" accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
        {shortKobo && shortKobo > 0 ? (
          <Button
            label={`Add ${naira(shortKobo)}`}
            onPress={() => router.push({ pathname: '/topup', params: { amount: String(shortKobo) } })}
          />
        ) : null}
        {onCancel ? <Button kind="plain" label="Cancel request" onPress={onCancel} loading={cancelling} /> : null}
      </Sheet>
    </View>
  );
}

function MarkWell({ kind }: { kind: 'pick' | 'stop' | 'drop' }) {
  return (
    <IconCircle>
      <StopMark kind={kind} />
    </IconCircle>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
