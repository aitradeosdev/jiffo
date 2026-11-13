import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { goBack } from '../nav';
import { useCountryConfig } from '../api/useCountryConfig';
import { distanceMeters } from '../location';
import { naira } from '../money';
import { useColors } from '../theme/theme';
import { fonts } from '../theme/tokens';
import { Button, Text } from '../ui/kit';
import { Avatar, Badge, IconCircle, List, Row } from '../ui/parts';
import { Fab, Sheet } from '../ui/floating';
import { JiffoMap } from '../ui/map/map';
import { StopMark } from '../ui/map/pins';
import type { MapPin } from '../ui/map/types';
import type { ErrandView } from '../errands/types';
import { upcoming, whenLabel } from '../errands/when';
import { km } from './board';
import { usePresence } from './presence';

const PIN_KIND = { pickup: 'pick', stop: 'stop', dropoff: 'drop' } as const;

/**
 * An open errand, as an agent sees it before accepting: the fee and what they keep, the route, the
 * customer and the request. Accepting holds the customer's money and opens the chat.
 */
export function AgentRequest({
  errand,
  onAccept,
  accepting,
  error,
}: {
  errand: ErrandView;
  onAccept: () => void;
  accepting: boolean;
  error: string | null;
}) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { config } = useCountryConfig();
  const { coords } = usePresence();
  const [sheetHeight, setSheetHeight] = useState(0);
  const category = config?.categories.find((k) => k.key === errand.categoryKey);
  const pickup = errand.stops[0]!;
  const route = errand.stops.slice(1).reduce((sum, s, i) => sum + distanceMeters(errand.stops[i]!, s), 0);
  const scheduled = upcoming(errand.scheduledFor);
  const pins: MapPin[] = [
    ...errand.stops.map((s) => ({ key: String(s.seq), kind: PIN_KIND[s.kind], lat: s.lat, lng: s.lng })),
    ...(coords ? [{ key: 'me', kind: 'me' as const, ...coords }] : []),
  ];

  return (
    <View style={[styles.fill, { backgroundColor: c.bg }]}>
      <JiffoMap pins={pins} showRoute insets={{ top: insets.top + 70, bottom: sheetHeight }} />
      <Fab icon="back" label="Back to the board" onPress={goBack} style={{ top: insets.top + 14, left: 16 }} />
      <Sheet onHeight={setSheetHeight} maxHeight="78%">
        {errand.urgent || scheduled ? (
          <View style={styles.badges}>
            {errand.urgent ? <Badge icon="zap" label="Urgent request" tone="urgent" /> : null}
            {scheduled ? <Badge icon="cal" label={`For ${whenLabel(scheduled)}`} /> : null}
          </View>
        ) : null}
        <View>
          <Text style={styles.fee} accessibilityLabel={`Fee ${naira(errand.feeKobo)}`}>
            {naira(errand.feeKobo)}
          </Text>
          {errand.agentEarnsKobo != null ? (
            <Text variant="sub" tone="ink3">
              You earn {naira(errand.agentEarnsKobo)} after commission
            </Text>
          ) : null}
        </View>
        <View style={styles.badges}>
          {category ? <Badge icon={category.icon} label={category.name} /> : null}
          {errand.buy ? <Badge icon="bag" label="You buy items first" tone="brand" /> : null}
        </View>

        <List>
          {errand.stops.map((s, i) => (
            <Row
              key={s.seq}
              iconNode={
                <IconCircle>
                  <StopMark kind={PIN_KIND[s.kind]} />
                </IconCircle>
              }
              title={s.label ?? s.address}
              subtitle={s.kind === 'pickup' ? 'Pickup' : s.kind === 'dropoff' ? 'Drop-off' : 'Stop'}
              right={
                <Text variant="note" tone="ink2" style={{ fontFamily: fonts.semibold }}>
                  {i === 0
                    ? coords
                      ? `${km(distanceMeters(coords, pickup))} away`
                      : ''
                    : i === errand.stops.length - 1
                      ? `${km(route)} errand`
                      : ''}
                </Text>
              }
            />
          ))}
          <Row
            iconNode={<Avatar name={errand.customer?.firstName} size={40} />}
            title={errand.customer?.firstName ?? 'Customer'}
            subtitle="Customer"
          />
        </List>
        <Text>{errand.description}</Text>
        {error ? (
          <Text tone="danger" accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
        <Button label="Accept errand" onPress={onAccept} loading={accepting} />
        <Button kind="plain" label="Decline" onPress={goBack} />
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  badges: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  fee: {
    fontFamily: fonts.extrabold,
    fontSize: 44,
    lineHeight: 48,
    letterSpacing: -1.3,
    fontVariant: ['tabular-nums'],
  },
});
