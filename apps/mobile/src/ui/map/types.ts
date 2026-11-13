import type { ViewStyle } from 'react-native';

export interface MapPoint {
  lat: number;
  lng: number;
}

/**
 * pick: ring circle, drop: ring square, stop: grey dot, agent: the agent's marker, fee: an errand on the
 * board with its fee above a dot, me: where the phone is.
 */
export type PinKind = 'pick' | 'stop' | 'drop' | 'agent' | 'fee' | 'me';

/** Pins that point at their place from below (their dot is at the bottom), rather than centred on it. */
export const pointsDown = (kind: PinKind) => kind === 'fee';

export interface MapPin extends MapPoint {
  key: string;
  kind: PinKind;
  /** Shown inside the agent marker (their initial), or the fee on a board pin. */
  label?: string;
  /** Tapping the pin, such as opening a board errand. */
  onPress?: () => void;
  /** Rings around the pin while nearby agents are being asked. */
  radar?: boolean;
}

export interface MapProps {
  pins: MapPin[];
  /** Draw a line through the pick, stop and drop pins, in that order. */
  showRoute?: boolean;
  /** Space covered by floating controls (top) and the sheet (bottom), kept clear when fitting. */
  insets: { top: number; bottom: number };
  /** Where to look when there are no pins. */
  center?: MapPoint | null;
  /** Show the phone's own location dot (only once location is allowed). */
  showsUser?: boolean;
  interactive?: boolean;
  style?: ViewStyle;
}

export interface MapHandle {
  /** Fit the pins again, or go back to the centre. */
  recenter(): void;
}

/** Lagos, where Jiffo starts, until the phone's location or a place is known. */
export const DEFAULT_CENTER: MapPoint = { lat: 6.4474, lng: 3.4723 };

/** The order route lines are drawn in. */
export const routeOf = (pins: MapPin[]) =>
  (['pick', 'stop', 'drop'] as const).flatMap((k) => pins.filter((p) => p.kind === k));
