import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { useColors } from '../theme/theme';
import { fonts } from '../theme/tokens';
import { Text } from '../ui/kit';
import { Icon, IconCircle } from '../ui/parts';

/** .fgroup: a field's name above it and a note below. */
export function FieldGroup({ label, note, children }: { label: string; note?: ReactNode; children: ReactNode }) {
  return (
    <View style={{ gap: 6 }}>
      <Text variant="small" style={{ fontFamily: fonts.semibold }} tone="ink2">
        {label}
      </Text>
      {children}
      {note ? (
        <Text variant="note" tone="ink3">
          {note}
        </Text>
      ) : null}
    </View>
  );
}

/** .input: a box that opens a list to choose from. */
export function SelectButton({
  label,
  value,
  placeholder,
  badge,
  onPress,
}: {
  label: string;
  value: string | null;
  placeholder: string;
  badge?: ReactNode;
  onPress: () => void;
}) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value ?? placeholder}`}
      onPress={onPress}
      style={({ pressed }) => [styles.select, { backgroundColor: c.surface2, opacity: pressed ? 0.7 : 1 }]}
    >
      <Text style={[styles.selectValue, { color: value ? c.ink : c.ink3 }]} numberOfLines={1}>
        {value ?? placeholder}
      </Text>
      {badge}
      <Icon name="down" size={18} color={c.ink2} />
    </Pressable>
  );
}

/** .waiting: a grey note with an icon or a spinner. */
export function Waiting({ icon, busy, title, sub }: { icon?: string; busy?: boolean; title: string; sub?: string }) {
  const c = useColors();
  return (
    <View
      style={[styles.note, { backgroundColor: c.surface2 }]}
      accessibilityRole={busy ? 'progressbar' : undefined}
      accessibilityLiveRegion="polite"
    >
      {busy ? <ActivityIndicator color={c.ink} /> : icon ? <Icon name={icon} size={19} /> : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.noteTitle}>{title}</Text>
        {sub ? (
          <Text variant="note" tone="ink3">
            {sub}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/** .lookup: the green note that something checked out. */
export function Confirmed({ title, sub }: { title: string; sub?: string }) {
  const c = useColors();
  return (
    <View style={[styles.note, { backgroundColor: c.brandSoft }]} accessibilityLiveRegion="polite">
      <IconCircle tone="brand" size={32}>
        <Icon name="check" size={18} weight={2.6} color={c.brandInk} />
      </IconCircle>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[styles.noteTitle, { letterSpacing: 0.3 }]}>{title}</Text>
        {sub ? (
          <Text variant="note" style={{ color: c.brandInk, fontFamily: fonts.semibold }}>
            {sub}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/** A row in a list of reassurances: an icon well, a bold line and a smaller one that wraps. */
export function Point({ icon, title, sub }: { icon: string; title: string; sub: string }) {
  return (
    <View style={styles.point}>
      <IconCircle icon={icon} />
      <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
        <Text variant="label">{title}</Text>
        <Text variant="small" tone="ink3">
          {sub}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  select: {
    height: 54,
    borderRadius: 10,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  selectValue: { flex: 1, fontFamily: fonts.semibold, fontSize: 17 },
  note: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
  },
  noteTitle: { fontFamily: fonts.bold, fontSize: 15, lineHeight: 20 },
  point: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 8, minHeight: 64 },
});
