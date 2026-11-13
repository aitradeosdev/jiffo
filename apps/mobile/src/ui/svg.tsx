import { SvgXml } from 'react-native-svg';
import { useColors } from '../theme/theme';
import { ICONS, WORDMARK } from './art.generated';

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
  filled,
}: {
  name: string;
  size?: number;
  color?: string;
  strokeWidth?: number;
  /** Fill the shape too, as the prototype does for chosen stars. */
  filled?: boolean;
}) {
  const c = useColors();
  const body = ICONS[name] ?? ICONS[ALIASES[name] ?? ''] ?? ICONS.info;
  const xml = `<svg viewBox="0 0 24 24" fill="${filled ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
  return <SvgXml xml={xml} width={size} height={size} color={color ?? c.ink} />;
}

/** The Jiffo wordmark as vector: letters in ink, the speed ball in brand green. */
export function WordmarkSvg({ height = 24, color, accent }: { height?: number; color?: string; accent?: string }) {
  const c = useColors();
  const xml = WORDMARK.replace(/\{brand\}/g, accent ?? c.brand);
  // viewBox is 408.73 × 193.6
  return (
    <SvgXml
      xml={xml}
      width={(height * 408.73) / 193.6}
      height={height}
      color={color ?? c.ink}
      accessibilityLabel="Jiffo"
    />
  );
}
