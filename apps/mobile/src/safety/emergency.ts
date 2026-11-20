/**
 * The emergency button (docs/security-plan.md, E9): dials the country's emergency number from the phone at
 * once, then tells Jiffo's safety team who pressed, on which errand and where, and keeps telling them where
 * the person is for a while. Nothing waits on the network before the call: the dialler opens first. Plain
 * TypeScript with its phone and network parts handed in, so it runs in tests.
 */

export interface Spot {
  lat: number;
  lng: number;
  accuracy?: number;
}

export interface EmergencyDeps {
  dial: (number: string) => void;
  /** Where the phone is now, or null when it can't say (no permission, no fix). */
  locate: () => Promise<Spot | null>;
  report: (body: { errandId?: string } & Partial<Spot>) => Promise<{ id: string }>;
  follow: (id: string, spot: Spot) => Promise<void>;
  every: (ms: number, run: () => void) => () => void;
}

/** How often, and for how long, the app sends where the person is after a press. */
export const FOLLOW_EVERY_MS = 30_000;
export const FOLLOW_FOR_MS = 10 * 60_000;

let stopFollowing: (() => void) | null = null;

/**
 * Dials, then reports. Gives the emergency's id once reported, or null when it couldn't be: the call has
 * been placed either way.
 */
export async function pressEmergency(deps: EmergencyDeps, input: { number: string; errandId?: string }) {
  deps.dial(input.number);
  const here = await deps.locate().catch(() => null);
  let id: string;
  try {
    ({ id } = await deps.report({
      ...(input.errandId ? { errandId: input.errandId } : {}),
      ...(here
        ? { lat: here.lat, lng: here.lng, ...(here.accuracy !== undefined ? { accuracy: here.accuracy } : {}) }
        : {}),
    }));
  } catch {
    return null;
  }
  // One emergency followed at a time: a second press follows the same one, as the server keeps them as one.
  stopFollowing?.();
  let sent = 0;
  const stop = deps.every(FOLLOW_EVERY_MS, () => {
    sent += 1;
    if (sent * FOLLOW_EVERY_MS > FOLLOW_FOR_MS) {
      stop();
      return;
    }
    void deps
      .locate()
      .then((spot) => (spot ? deps.follow(id, spot) : undefined))
      .catch(() => undefined);
  });
  stopFollowing = stop;
  return id;
}

/** The number to dial: the country's, from its settings, or the one most countries answer. */
export const emergencyNumberOf = (settings: { safety?: { emergencyNumber?: string } } | undefined) =>
  settings?.safety?.emergencyNumber ?? '112';
