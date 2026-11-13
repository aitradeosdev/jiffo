import type { ComponentProps, ReactNode } from 'react';
import { Pressable, StyleSheet, Switch, View, type ViewStyle } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useColors } from '../theme/theme';
import { radius, space } from '../theme/tokens';
import { Text } from './kit';

export type IconName = ComponentProps<typeof Feather>['name'];

export function Icon({ name, size = 20, color }: { name: IconName; size?: number; color?: string }) {
  const c = useColors();
  return <Feather name={name} size={size} color={color ?? c.ink} />;
}

/** Category icons by the key admin gives each category. */
const CATEGORY_ICONS: Record<string, ComponentProps<typeof MaterialCommunityIcons>['name']> = {
  cart: 'cart-outline',
  food: 'food-outline',
  pill: 'pill',
  bag: 'shopping-outline',
  shirt: 'tshirt-crew-outline',
  box: 'package-variant-closed',
  users: 'account-group-outline',
  spark: 'star-four-points-outline',
};

export function CategoryIcon({ icon, size = 22, color }: { icon: string; size?: number; color?: string }) {
  const c = useColors();
  return <MaterialCommunityIcons name={CATEGORY_ICONS[icon] ?? 'dots-horizontal'} size={size} color={color ?? c.ink} />;
}

/** A tappable list row: icon, title, subtitle and something on the right. */
export function Row({
  icon,
  iconNode,
  title,
  subtitle,
  right,
  onPress,
  tone,
}: {
  icon?: IconName;
  iconNode?: ReactNode;
  title: string;
  subtitle?: string | null;
  right?: ReactNode;
  onPress?: () => void;
  tone?: 'brand' | 'danger';
}) {
  const c = useColors();
  const body = (
    <>
      {icon || iconNode ? (
        <View style={[styles.rowIcon, { backgroundColor: tone === 'brand' ? c.brandSoft : c.surface2 }]}>
          {iconNode ?? <Icon name={icon!} size={19} color={tone === 'brand' ? c.brandInk : c.ink} />}
        </View>
      ) : null}
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="label" tone={tone === 'danger' ? 'danger' : 'ink'}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="small" tone="ink3" numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right ?? (onPress ? <Icon name="chevron-right" size={18} color={c.ink3} /> : null)}
    </>
  );
  if (!onPress) return <View style={styles.row}>{body}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
    >
      {body}
    </Pressable>
  );
}

export function Card({ children, style, tone }: { children: ReactNode; style?: ViewStyle; tone?: 'brand' | 'urgent' }) {
  const c = useColors();
  const bg = tone === 'brand' ? c.brandSoft : tone === 'urgent' ? c.urgentSoft : c.surface2;
  return <View style={[styles.card, { backgroundColor: bg }, style]}>{children}</View>;
}

export function Chip({
  label,
  icon,
  selected,
  onPress,
}: {
  label: string;
  icon?: IconName;
  selected?: boolean;
  onPress: () => void;
}) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      onPress={onPress}
      style={[styles.chip, { backgroundColor: selected ? c.ink : c.surface2 }]}
    >
      {icon ? <Icon name={icon} size={15} color={selected ? c.onInk : c.ink} /> : null}
      <Text variant="small" style={{ color: selected ? c.onInk : c.ink, fontFamily: 'Figtree_600SemiBold' }}>
        {label}
      </Text>
    </Pressable>
  );
}

export function ToggleRow({
  title,
  subtitle,
  value,
  onChange,
}: {
  title: string;
  subtitle?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  const c = useColors();
  return (
    <View style={styles.row}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="label">{title}</Text>
        {subtitle ? (
          <Text variant="small" tone="ink3">
            {subtitle}
          </Text>
        ) : null}
      </View>
      <Switch
        accessibilityLabel={title}
        value={value}
        onValueChange={onChange}
        trackColor={{ true: c.brand, false: c.surface3 }}
        thumbColor="#FFFFFF"
      />
    </View>
  );
}

export function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <View style={{ gap: space.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text variant="heading" accessibilityRole="header">
          {title}
        </Text>
        {action}
      </View>
      {children}
    </View>
  );
}

export function Empty({
  icon,
  title,
  body,
  action,
}: {
  icon: IconName;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  const c = useColors();
  return (
    <View style={{ alignItems: 'center', gap: space.sm, paddingVertical: space.xxl }}>
      <View style={[styles.rowIcon, { width: 52, height: 52, borderRadius: 26, backgroundColor: c.surface2 }]}>
        <Icon name={icon} size={24} />
      </View>
      <Text variant="label">{title}</Text>
      <Text variant="small" tone="ink3" style={{ textAlign: 'center', maxWidth: 280 }}>
        {body}
      </Text>
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md, minHeight: 56 },
  rowIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  card: { borderRadius: radius.lg, padding: space.lg, gap: space.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    minHeight: 38,
    borderRadius: radius.pill,
  },
});
