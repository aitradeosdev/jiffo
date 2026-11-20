/** How often the agent app reports where the agent is, at most, in the foreground and the background. */
export const REPORT_EVERY_MS = 10_000;

/**
 * Whether the background task sends a position it was given: only while the app isn't on screen (the app
 * sends its own then), and at most every REPORT_EVERY_MS.
 */
export function shouldSendFromBackground(appState: string | null | undefined, now: number, lastSent: number) {
  return appState !== 'active' && now - lastSent >= REPORT_EVERY_MS;
}

interface PhonePosition {
  timestamp: number;
  coords: { latitude: number; longitude: number; accuracy?: number | null };
  /** Android: the phone says a mock-location app made this position. */
  mocked?: boolean;
}

/**
 * A position as the app reports it: where, when the phone took the fix and how far off it might be, for the
 * server's GPS checks (docs/security-plan.md, G1), and whether the phone says it is mocked (MB4), which
 * can't place the agent at a drop-off.
 */
export function reported(position: PhonePosition) {
  const { accuracy } = position.coords;
  return {
    lat: position.coords.latitude,
    lng: position.coords.longitude,
    fixedAt: position.timestamp,
    ...(typeof accuracy === 'number' && accuracy >= 0 ? { accuracy } : {}),
    ...(position.mocked ? { mocked: true } : {}),
  };
}

/** The newest of the positions the phone hands the task at once, or null when there are none. */
export function latestPosition(locations: ReadonlyArray<PhonePosition> | undefined) {
  if (!locations?.length) return null;
  return reported(locations.reduce((a, b) => (b.timestamp > a.timestamp ? b : a)));
}

/**
 * When the agent's position was last sent, shared by the app and the background task in the same process
 * (on Android the app keeps running behind the task), so the two never both send within REPORT_EVERY_MS.
 */
let lastSentAt = 0;
export const markSent = (at = Date.now()) => {
  lastSentAt = at;
};
export const lastSent = () => lastSentAt;
