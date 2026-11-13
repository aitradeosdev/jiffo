import { SvgXml } from 'react-native-svg';
import { useColors } from '../theme/theme';
import type { Palette } from '../theme/tokens';
import { ART, ICONS, WORDMARK } from './art.generated';

/** Older icon names the screens used, mapped onto the prototype's icon set. */
const ALIASES: Record<string, string> = {
  'arrow-left': 'back',
  'chevron-right': 'chev',
  'credit-card': 'wallet',
  briefcase: 'bank',
  sliders: 'tune',
  'message-circle': 'chat',
  send: 'up',
  'check-square': 'check',
  'check-circle': 'check',
  grid: 'menu',
  navigation: 'nav',
  'map-pin': 'pin',
  list: 'history',
  inbox: 'doc',
  calendar: 'cal',
  'alert-circle': 'alert',
  'arrow-down-left': 'down',
  'arrow-up-right': 'up',
  'rotate-ccw': 'history',
};

/** A line icon from the prototype's set, drawn in the given colour. */
export function SvgIcon({
  name,
  size = 22,
  color,
  strokeWidth = 1.85,
}: {
  name: string;
  size?: number;
  color?: string;
  strokeWidth?: number;
}) {
  const c = useColors();
  const body = ICONS[name] ?? ICONS[ALIASES[name] ?? ''] ?? ICONS.info;
  const xml = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
  return <SvgXml xml={xml} width={size} height={size} color={color ?? c.ink} />;
}

const TOKENS: Record<string, keyof Palette> = {
  'ill-a': 'illA',
  'ill-b': 'illB',
  'ill-c': 'illC',
  'ill-d': 'illD',
  'ill-e': 'illE',
  'ill-f': 'illF',
  brand: 'brand',
  'brand-soft': 'brandSoft',
  'surface-3': 'surface3',
};
const paint = (xml: string, c: Palette) =>
  xml.replace(/\{([a-z0-9-]+)\}/g, (_, t: string) => (TOKENS[t] ? c[TOKENS[t]] : '#999999'));

export const hasArt = (name: string) => name in ART;

/** A category illustration (groceries, parcel, pharmacy, queue), in the theme's colours. */
export function Art({ name, size = 40 }: { name: string; size?: number }) {
  const c = useColors();
  const xml = ART[name];
  if (!xml) return null;
  return <SvgXml xml={paint(xml, c)} width={size} height={size} />;
}

/** The Jiffo wordmark as vector: letters in ink, the speed ball in brand green. */
export function WordmarkSvg({ height = 24, color }: { height?: number; color?: string }) {
  const c = useColors();
  // viewBox is 408.73 × 193.6
  return (
    <SvgXml
      xml={paint(WORDMARK, c)}
      width={(height * 408.73) / 193.6}
      height={height}
      color={color ?? c.ink}
      accessibilityLabel="Jiffo"
    />
  );
}
