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
  coords: { latitude: number; longitude: number };
  /** Android: the phone says a mock-location app made this position. */
  mocked?: boolean;
}

/**
 * A position as the app reports it: where, and whether the phone says it is mocked (docs/security-plan.md,
 * MB4), which can't place the agent at a drop-off.
 */
export function reported(position: PhonePosition) {
  return {
    lat: position.coords.latitude,
    lng: position.coords.longitude,
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
