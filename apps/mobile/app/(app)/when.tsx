import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { goBack } from '@/nav';
import { useDraft } from '@/errands/draft';
import { liveSchedule, whenLabel } from '@/errands/when';
import { useColors } from '@/theme/theme';
import { Button, Screen, Text } from '@/ui/kit';
import { Chip, Icon, List, Row } from '@/ui/parts';

const DAYS = 7;
const FIRST_HOUR = 7;
const LAST_HOUR = 21;
/** The API wants a schedule at least 15 minutes ahead; leave room to finish the request. */
const LEAD_MS = 45 * 60 * 1000;

function slotsFor(day: Date) {
  const out: Date[] = [];
  for (let h = FIRST_HOUR; h <= LAST_HOUR; h += 1) {
    for (const m of [0, 30]) {
      const at = new Date(day);
      at.setHours(h, m, 0, 0);
      if (at.getTime() >= Date.now() + LEAD_MS) out.push(at);
    }
  }
  return out;
}

/** "When do you need it?": now, or a day and a half-hour slot within the next week. */
export default function When() {
  const c = useColors();
  const { draft, update } = useDraft();
  const current = liveSchedule(draft.scheduledFor);
  const days = useMemo(
    () =>
      Array.from({ length: DAYS }, (_, i) => {
        const d = new Date();
        d.setDate(d.getDate() + i);
        d.setHours(0, 0, 0, 0);
        return d;
      }).filter((d) => slotsFor(d).length > 0),
    [],
  );
  const [later, setLater] = useState(!!current);
  const [day, setDay] = useState(() => {
    const at = current ? new Date(current) : null;
    return Math.max(0, at ? days.findIndex((d) => d.toDateString() === at.toDateString()) : 0);
  });
  const [slot, setSlot] = useState<string | null>(current);
  const slots = days[day] ? slotsFor(days[day]) : [];

  const now = () => {
    update({ scheduledFor: null });
    goBack();
  };
  const done = () => {
    // A scheduled errand can't also be urgent.
    update({ scheduledFor: slot, urgent: false });
    goBack();
  };

  return (
    <Screen
      footer={
        later ? (
          <Button label={slot ? `Schedule for ${whenLabel(slot)}` : 'Choose a time'} disabled={!slot} onPress={done} />
        ) : undefined
      }
    >
      <Text variant="heading" accessibilityRole="header">
        When do you need it?
      </Text>
      <List>
        <Row
          iconNode={<Tile icon="zap" on={!later} />}
          title="Now"
          subtitle="Matched with an agent right away"
          right={!later ? <Icon name="check" /> : null}
          onPress={now}
        />
        <Row
          iconNode={<Tile icon="cal" on={later} />}
          title={slot ? whenLabel(slot) : 'Schedule for later'}
          subtitle="Goes on the board ahead of time"
          right={later ? <Icon name="check" /> : null}
          onPress={() => setLater(true)}
        />
      </List>
      {later ? (
        <View style={{ gap: 12 }}>
          <Text variant="sec">Day</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {days.map((d, i) => (
              <Chip
                key={d.toISOString()}
                label={
                  i === 0 && d.toDateString() === new Date().toDateString()
                    ? 'Today'
                    : d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
                }
                selected={i === day}
                onPress={() => {
                  setDay(i);
                  setSlot(null);
                }}
              />
            ))}
          </ScrollView>
          <Text variant="sec">Time</Text>
          <View style={[styles.chips, { flexWrap: 'wrap' }]}>
            {slots.map((s) => (
              <Chip
                key={s.toISOString()}
                label={s.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                selected={slot === s.toISOString()}
                onPress={() => setSlot(s.toISOString())}
              />
            ))}
          </View>
          <Text variant="note" tone="ink3" style={{ color: c.ink3 }}>
            A scheduled errand can&apos;t be urgent. Nothing is held until an agent accepts it.
          </Text>
        </View>
      ) : null}
    </Screen>
  );
}

function Tile({ icon, on }: { icon: string; on: boolean }) {
  const c = useColors();
  return (
    <View style={[styles.tile, { backgroundColor: on ? c.brandSoft : c.surface2 }]}>
      <Icon name={icon} size={19} color={on ? c.brandInk : c.ink} />
    </View>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', gap: 8 },
  tile: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
});
