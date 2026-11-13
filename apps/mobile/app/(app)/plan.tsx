import { useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { goBack } from '@/nav';
import { useCountryConfig } from '@/api/useCountryConfig';
import { useDraft, type StopField } from '@/errands/draft';
import { liveSchedule, staleSchedule, whenLabel } from '@/errands/when';
import { useColors } from '@/theme/theme';
import { fonts } from '@/theme/tokens';
import { Button, noWebOutline, Text } from '@/ui/kit';
import { Chip, Icon, IconCircle, Toggle } from '@/ui/parts';
import { PageFooter, PageHeader } from '@/ui/floating';
import { StopMark } from '@/ui/map/pins';

export default function Plan() {
  const c = useColors();
  const { config } = useCountryConfig();
  const { draft, update } = useDraft();
  const [descFocused, setDescFocused] = useState(false);
  const category = config?.categories.find((k) => k.key === draft.categoryKey) ?? null;
  const buy = draft.buy ?? category?.buyDefault ?? false;
  const ready = !!category && draft.description.trim().length >= 3 && !!draft.pickup && !!draft.dropoff;
  const schedule = liveSchedule(draft.scheduledFor);

  const field = (kind: StopField, placeholder: string) => {
    const place = draft[kind];
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={place ? `${placeholder}: ${place.name}. Change` : placeholder}
        onPress={() => router.push({ pathname: '/place', params: { field: kind } })}
        style={[styles.input, { backgroundColor: c.surface2 }]}
      >
        {place ? (
          <Text style={styles.val} numberOfLines={1}>
            {place.name}
            <Text style={[styles.addr, { color: c.ink3 }]}> · {place.address}</Text>
          </Text>
        ) : (
          <Text style={[styles.phd, { color: c.ink3 }]} numberOfLines={1}>
            {placeholder}
          </Text>
        )}
      </Pressable>
    );
  };

  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: c.surface }]} edges={['top', 'bottom']}>
      <PageHeader title="Plan your errand" onBack={goBack} />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={category ? `Category: ${category.name}. Change` : 'Choose a category'}
          onPress={() => router.push('/category')}
          style={[
            styles.input,
            category ? { backgroundColor: c.surface2 } : { backgroundColor: c.surface, borderColor: c.ink },
          ]}
        >
          <IconCircle icon={category ? category.icon : 'menu'} tone={category ? 'ink' : undefined} size={32} />
          {category ? (
            <Text style={styles.val} numberOfLines={1}>
              {category.name}
            </Text>
          ) : (
            <Text style={[styles.phd, { color: c.ink3 }]}>Choose a category</Text>
          )}
          <View style={styles.catlink}>
            <Text style={[styles.catlinkText, { color: c.ink3 }]}>{category ? 'Change' : 'Required'}</Text>
            <Icon name="chev" size={16} color={c.ink3} />
          </View>
        </Pressable>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          <Chip
            label={staleSchedule(draft.scheduledFor) ? 'Pick a new time' : whenLabel(schedule)}
            icon="clock"
            trailingIcon="down"
            onPress={() => router.push('/when')}
          />
          <Chip
            label="Urgent"
            icon="zap"
            urgent
            selected={draft.urgent}
            // Urgent errands go out now, so turning it on drops any schedule.
            onPress={() => update(draft.urgent ? { urgent: false } : { urgent: true, scheduledFor: null })}
          />
        </ScrollView>

        <TextInput
          accessibilityLabel="What do you need done?"
          value={draft.description}
          onChangeText={(description) => update({ description })}
          onFocus={() => setDescFocused(true)}
          onBlur={() => setDescFocused(false)}
          placeholder="What do you need done? For example: buy 2 loaves of bread at the bakery and bring them home"
          placeholderTextColor={c.ink3}
          multiline
          maxLength={1000}
          style={[
            styles.desc,
            {
              backgroundColor: descFocused ? c.surface : c.surface2,
              borderColor: descFocused ? c.ink : 'transparent',
              color: c.ink,
            },
          ]}
        />

        <View style={[styles.buyrow, { borderColor: c.line2 }]}>
          <IconCircle icon="bag" tone={buy ? 'brand' : undefined} size={36} />
          <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
            <Text style={styles.buyTitle}>Agent buys items</Text>
            <Text variant="note" tone="ink3">
              {buy
                ? 'You lock the item amount after they send the receipt'
                : 'They only collect, deliver or do the task'}
            </Text>
          </View>
          <Toggle label="Agent buys items" green value={buy} onChange={(v) => update({ buy: v })} />
        </View>

        <View style={styles.stops}>
          <StopRow mark={<StopMark kind="pick" />}>{field('pickup', 'Pickup location')}</StopRow>
          <Rail />
          {draft.stop ? (
            <>
              <StopRow mark={<StopMark kind="stop" />}>
                <View style={{ flex: 1 }}>{field('stop', 'Extra stop')}</View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Remove stop"
                  onPress={() => update({ stop: null })}
                  style={styles.ib}
                >
                  <Icon name="x" size={18} />
                </Pressable>
              </StopRow>
              <Rail />
            </>
          ) : null}
          <StopRow mark={<StopMark kind="drop" />}>{field('dropoff', 'Drop-off location')}</StopRow>
        </View>
        {!draft.stop ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push({ pathname: '/place', params: { field: 'stop' } })}
            style={{ alignSelf: 'flex-start', marginLeft: 30 }}
            hitSlop={8}
          >
            <Text style={styles.link}>Add a stop</Text>
          </Pressable>
        ) : null}

        <Text variant="note" tone="ink3">
          {buy
            ? "Say what to buy, where, and anything the agent should know. You agree the item amount with your agent in chat; it's held separately and paid at hand-off."
            : 'Say what to collect, deliver or do, where, and anything the agent should know.'}
        </Text>
      </ScrollView>
      <PageFooter>
        <Button label="Continue" disabled={!ready} onPress={() => router.push('/review')} />
      </PageFooter>
    </SafeAreaView>
  );
}

function StopRow({ mark, children }: { mark: ReactNode; children: ReactNode }) {
  return (
    <View style={styles.stopRow}>
      <View style={styles.markCol}>{mark}</View>
      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 }}>{children}</View>
    </View>
  );
}

/** The black line joining the stop markers. */
function Rail() {
  const c = useColors();
  return <View style={[styles.rail, { backgroundColor: c.ink }]} />;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  body: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 28, gap: 14 },
  input: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 52,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  val: { flex: 1, minWidth: 0, fontFamily: fonts.semibold, fontSize: 16 },
  addr: { fontFamily: fonts.medium, fontSize: 16 },
  phd: { flex: 1, minWidth: 0, fontFamily: fonts.medium, fontSize: 16 },
  catlink: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  catlinkText: { fontFamily: fonts.bold, fontSize: 13.5 },
  chips: { flexDirection: 'row', gap: 8 },
  desc: {
    minHeight: 96,
    borderRadius: 12,
    borderWidth: 2,
    padding: 14,
    fontSize: 16,
    lineHeight: 23,
    fontFamily: fonts.regular,
    textAlignVertical: 'top',
    ...noWebOutline,
  },
  buyrow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  buyTitle: { fontFamily: fonts.bold, fontSize: 15 },
  stops: { gap: 8 },
  stopRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  markCol: { width: 20, alignItems: 'center' },
  rail: { width: 2, height: 24, marginVertical: -8, marginLeft: 9 },
  ib: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  link: { fontFamily: fonts.bold, fontSize: 14, textDecorationLine: 'underline' },
});
