import { Children, type ReactNode } from 'react';
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';
import { SvgIcon } from './svg';
import { useColors } from '../theme/theme';
import { fonts, radius, space } from '../theme/tokens';
import { Text } from './kit';

export type IconName = string;

/** The prototype's line icons. */
export function Icon({
  name,
  size = 20,
  color,
  weight,
  filled,
}: {
  name: IconName;
  size?: number;
  color?: string;
  weight?: number;
  filled?: boolean;
}) {
  return <SvgIcon name={name} size={size} color={color} strokeWidth={weight} filled={filled} />;
}

/** A category's icon by the key admin gives it (cart, food, pill, bag, shirt, box, users, spark). */
export function CategoryIcon({ icon, size = 22, color }: { icon: string; size?: number; color?: string }) {
  return <SvgIcon name={icon} size={size} color={color} />;
}

type RowTone = 'brand' | 'urgent' | 'ink' | 'danger';

/** .ico: the 40px round icon well. brand is green, urgent orange, ink black. */
export function IconCircle({
  icon,
  tone,
  size = 40,
  children,
}: {
  icon?: IconName;
  tone?: RowTone;
  size?: number;
  children?: ReactNode;
}) {
  const c = useColors();
  const bg = tone === 'brand' ? c.brandSoft : tone === 'urgent' ? c.urgentSoft : tone === 'ink' ? c.ink : c.surface2;
  const fg = tone === 'brand' ? c.brandInk : tone === 'urgent' ? c.urgent : tone === 'ink' ? c.onInk : c.ink;
  return (
    <View style={[styles.rowIcon, { width: size, height: size, borderRadius: size / 2, backgroundColor: bg }]}>
      {children ?? (icon ? <Icon name={icon} size={Math.round(size * 0.475)} color={fg} /> : null)}
    </View>
  );
}

/** .li: a list row with an icon well, a title, a one-line subtitle and something on the right. */
export function Row({
  icon,
  iconNode,
  title,
  subtitle,
  subtitleLines = 1,
  right,
  onPress,
  tone,
  disabled,
}: {
  icon?: IconName;
  iconNode?: ReactNode;
  title: string;
  subtitle?: string | null;
  subtitleLines?: number;
  right?: ReactNode;
  onPress?: () => void;
  tone?: RowTone;
  disabled?: boolean;
}) {
  const c = useColors();
  const body = (
    <>
      {iconNode ?? (icon ? <IconCircle icon={icon} tone={tone === 'danger' ? undefined : tone} /> : null)}
      <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
        <Text variant="label" tone={tone === 'danger' ? 'danger' : 'ink'} numberOfLines={2}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="small" tone="ink3" numberOfLines={subtitleLines}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right ?? (onPress && tone !== 'danger' ? <Icon name="chev" size={18} color={c.ink3} /> : null)}
    </>
  );
  if (!onPress) return <View style={styles.row}>{body}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.row, (pressed || disabled) && { opacity: 0.55 }]}
    >
      {body}
    </Pressable>
  );
}

/** .list: rows with a hairline between them, starting after the icon well. */
export function List({ children, inset = 54 }: { children: ReactNode; inset?: number }) {
  const c = useColors();
  const items = Children.toArray(children).filter(Boolean);
  return (
    <View>
      {items.map((child, i) => (
        <View key={i}>
          {i > 0 ? <View style={[styles.hairline, { left: inset, backgroundColor: c.line }]} /> : null}
          {child}
        </View>
      ))}
    </View>
  );
}

/** A round tick for multi-choice lists: filled black when chosen, an empty ring when not. */
export function CheckMark({ on }: { on: boolean }) {
  const c = useColors();
  return (
    <View
      style={{
        width: 24,
        height: 24,
        borderRadius: 12,
        borderWidth: on ? 0 : 2,
        borderColor: c.line2,
        backgroundColor: on ? c.ink : 'transparent',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {on ? <Icon name="check" size={16} weight={2.6} color={c.onInk} /> : null}
    </View>
  );
}

/** .badge: a small rounded label. */
export function Badge({ label, icon, tone }: { label: string; icon?: IconName; tone?: 'brand' | 'urgent' }) {
  const c = useColors();
  const bg = tone === 'brand' ? c.brandSoft : tone === 'urgent' ? c.urgentSoft : c.surface2;
  const fg = tone === 'brand' ? c.brandInk : tone === 'urgent' ? c.urgent : c.ink2;
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      {icon ? <Icon name={icon} size={12} color={fg} /> : null}
      <Text style={{ fontFamily: fonts.bold, fontSize: 12, color: fg, flexShrink: 1 }} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/** .switch: 50 by 30; black when on, or green for the "agent buys items" switch. */
export function Toggle({
  value,
  onChange,
  label,
  green,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
  label: string;
  green?: boolean;
}) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value }}
      onPress={() => onChange(!value)}
      hitSlop={6}
      style={[styles.switch, { backgroundColor: value ? (green ? c.brand2 : c.ink) : c.surface3 }]}
    >
      <View style={[styles.knob, { transform: [{ translateX: value ? 20 : 0 }] }]} />
    </Pressable>
  );
}

/** A person's round initial, standing in for their photo. */
export function Avatar({
  name,
  size = 40,
  onInk,
}: {
  name: string | null | undefined;
  size?: number;
  onInk?: boolean;
}) {
  const c = useColors();
  return (
    <View
      style={[
        styles.rowIcon,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: onInk ? 'rgba(255,255,255,0.14)' : c.brandSoft,
        },
      ]}
    >
      <Text style={{ fontFamily: fonts.bold, fontSize: size * 0.4, color: onInk ? c.onInk : c.brandInk }}>
        {(name?.trim()[0] ?? '?').toUpperCase()}
      </Text>
    </View>
  );
}

export function Card({ children, style, tone }: { children: ReactNode; style?: ViewStyle; tone?: 'brand' | 'urgent' }) {
  const c = useColors();
  const bg = tone === 'brand' ? c.brandSoft : tone === 'urgent' ? c.urgentSoft : c.surface2;
  return <View style={[styles.card, { backgroundColor: bg }, style]}>{children}</View>;
}

/** .chip: 36 high. Pressed chips turn black, or orange for Urgent. */
export function Chip({
  label,
  icon,
  trailingIcon,
  selected,
  urgent,
  onPress,
}: {
  label: string;
  icon?: IconName;
  trailingIcon?: IconName;
  selected?: boolean;
  urgent?: boolean;
  onPress: () => void;
}) {
  const c = useColors();
  const bg = selected ? (urgent ? c.urgent : c.ink) : c.surface2;
  const fg = selected ? (urgent ? '#FFFFFF' : c.onInk) : c.ink;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={selected === undefined ? undefined : { selected }}
      accessibilityLabel={label}
      onPress={onPress}
      style={[styles.chip, { backgroundColor: bg }]}
    >
      {icon ? <Icon name={icon} size={16} color={fg} /> : null}
      <Text style={{ color: fg, fontFamily: fonts.semibold, fontSize: 14 }}>{label}</Text>
      {trailingIcon ? <Icon name={trailingIcon} size={15} color={fg} /> : null}
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
      <Toggle label={title} value={value} onChange={onChange} />
    </View>
  );
}

export function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <View style={{ gap: space.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text variant="sec" accessibilityRole="header">
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
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 8, minHeight: 64 },
  rowIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  hairline: { position: 'absolute', top: 0, right: 0, height: StyleSheet.hairlineWidth * 2 },
  card: { borderRadius: 14, padding: space.lg, gap: space.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    height: 36,
    borderRadius: radius.pill,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 24,
    paddingHorizontal: 9,
    borderRadius: radius.pill,
    alignSelf: 'flex-start',
    flexShrink: 1,
    maxWidth: 140,
  },
  switch: { width: 50, height: 30, borderRadius: radius.pill, padding: 3 },
  knob: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
  },
});
