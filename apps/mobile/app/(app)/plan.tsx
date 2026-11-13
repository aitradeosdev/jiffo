import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useCountryConfig } from '@/api/useCountryConfig';
import { useDraft, type StopField } from '@/errands/draft';
import { useColors } from '@/theme/theme';
import { fonts, radius, space } from '@/theme/tokens';
import { Button, Screen, Text } from '@/ui/kit';
import { CategoryIcon, Chip, Icon, ToggleRow } from '@/ui/parts';

export default function Plan() {
  const c = useColors();
  const { config } = useCountryConfig();
  const { draft, update } = useDraft();
  const category = config?.categories.find((k) => k.key === draft.categoryKey) ?? null;
  const buy = draft.buy ?? category?.buyDefault ?? false;
  const ready = !!category && draft.description.trim().length >= 3 && !!draft.pickup && !!draft.dropoff;

  const stopButton = (field: StopField, placeholder: string) => {
    const place = draft[field];
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={place ? `${placeholder}: ${place.name}. Change` : placeholder}
        onPress={() => router.push({ pathname: '/place', params: { field } })}
        style={[styles.input, { backgroundColor: c.surface2 }]}
      >
        <View
          style={[styles.dot, { backgroundColor: field === 'dropoff' ? c.ink : field === 'pickup' ? c.brand : c.ink3 }]}
        />
        <View style={{ flex: 1 }}>
          {place ? (
            <>
              <Text variant="label" numberOfLines={1}>
                {place.name}
              </Text>
              <Text variant="small" tone="ink3" numberOfLines={1}>
                {place.address}
              </Text>
            </>
          ) : (
            <Text variant="label" tone="ink3">
              {placeholder}
            </Text>
          )}
        </View>
      </Pressable>
    );
  };

  return (
    <Screen footer={<Button label="Continue" disabled={!ready} onPress={() => router.push('/review')} />}>
      <View style={styles.head}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} hitSlop={12}>
          <Icon name="arrow-left" size={24} />
        </Pressable>
        <Text variant="heading">Plan your errand</Text>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={category ? `Category: ${category.name}. Change` : 'Choose a category'}
        onPress={() => router.push('/category')}
        style={[styles.input, { backgroundColor: c.surface2 }]}
      >
        {category ? <CategoryIcon icon={category.icon} /> : <Icon name="grid" />}
        <Text variant="label" tone={category ? 'ink' : 'ink3'} style={{ flex: 1 }}>
          {category ? category.name : 'Choose a category'}
        </Text>
        <Text variant="small" tone="brand">
          {category ? 'Change' : 'Required'}
        </Text>
      </Pressable>

      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <Chip label="Urgent" icon="zap" selected={draft.urgent} onPress={() => update({ urgent: !draft.urgent })} />
      </View>

      <TextInput
        accessibilityLabel="What do you need done?"
        value={draft.description}
        onChangeText={(description) => update({ description })}
        placeholder="What do you need done? For example: buy 2 loaves of bread at the bakery and bring them home"
        placeholderTextColor={c.ink3}
        multiline
        maxLength={1000}
        style={[styles.desc, { backgroundColor: c.surface2, color: c.ink, fontFamily: fonts.medium }]}
      />

      <ToggleRow
        title="Agent buys items"
        subtitle={
          buy ? 'You lock the item amount after they send the receipt' : 'They only collect, deliver or do the task'
        }
        value={buy}
        onChange={(v) => update({ buy: v })}
      />

      <View style={{ gap: space.sm }}>
        {stopButton('pickup', 'Pickup location')}
        {draft.stop ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <View style={{ flex: 1 }}>{stopButton('stop', 'Extra stop')}</View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Remove stop"
              onPress={() => update({ stop: null })}
              hitSlop={10}
            >
              <Icon name="x" />
            </Pressable>
          </View>
        ) : null}
        {stopButton('dropoff', 'Drop-off location')}
        {!draft.stop ? (
          <Text
            variant="label"
            tone="brand"
            accessibilityRole="button"
            onPress={() => router.push({ pathname: '/place', params: { field: 'stop' } })}
          >
            Add a stop
          </Text>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  input: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    minHeight: 56,
    borderRadius: radius.md,
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  desc: { minHeight: 96, borderRadius: radius.md, padding: space.lg, fontSize: 16, textAlignVertical: 'top' },
});
