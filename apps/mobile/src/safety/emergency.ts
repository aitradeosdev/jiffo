/**
 * The emergency button (docs/security-plan.md, E9): dials the country's emergency number from the phone at
 * once, then tells Jiffo's safety team at once who pressed and on which errand, and where they are as soon
 * as the phone can say, and keeps telling them for a while. Nothing waits on the network before the call,
 * and the report waits on nothing: not a location, not a permission prompt. Plain TypeScript with its phone
 * and network parts handed in, so it runs in tests.
 */

export interface Spot {
  lat: number;
  lng: number;
  accuracy?: number;
}

export interface EmergencyDeps {
  dial: (number: string) => void;
  /**
   * Where the phone is now, or null when it can't say. `ask` may ask for permission (once, just after the
   * press); the follow-ups never ask again.
   */
  locate: (ask: boolean) => Promise<Spot | null>;
  report: (body: { errandId?: string }) => Promise<{ id: string }>;
  follow: (id: string, spot: Spot) => Promise<void>;
  every: (ms: number, run: () => void) => () => void;
  wait: (ms: number) => Promise<void>;
  /** Jiffo couldn't be reached at all: the person is told, as the call itself was placed. */
  unreached: () => void;
}

/** How often, and for how long, the app sends where the person is after a press. */
export const FOLLOW_EVERY_MS = 30_000;
export const FOLLOW_FOR_MS = 10 * 60_000;
/** The report is tried again after each of these waits: about four minutes in all, on a weak signal. */
export const REPORT_RETRY_MS = [3_000, 7_000, 15_000, 30_000, 60_000, 60_000, 60_000];
/** A second tap this soon is the same press: it neither dials again nor reports again. */
export const SAME_PRESS_MS = 3_000;

let stopFollowing: (() => void) | null = null;
let lastPress: { at: number; result: Promise<string | null> } | null = null;

/** Dials, then reports. Gives the emergency's id once reported, or null when Jiffo couldn't be reached. */
export function pressEmergency(
  deps: EmergencyDeps,
  input: { number: string; errandId?: string },
  now = Date.now(),
): Promise<string | null> {
  if (lastPress && now - lastPress.at < SAME_PRESS_MS) return lastPress.result;
  deps.dial(input.number);
  const result = reportAndFollow(deps, input);
  lastPress = { at: now, result };
  return result;
}

async function reportAndFollow(deps: EmergencyDeps, input: { errandId?: string }) {
  const id = await reportWithRetries(deps, input);
  if (!id) {
    deps.unreached();
    return null;
  }
  // Where they are, as soon as the phone can say: asking for permission now, if it never was.
  void deps
    .locate(true)
    .then((spot) => (spot ? deps.follow(id, spot) : undefined))
    .catch(() => undefined);
  // One emergency followed at a time: a second press follows the same one, as the server keeps them as one.
  stopFollowing?.();
  let ticks = 0;
  const stop = deps.every(FOLLOW_EVERY_MS, () => {
    ticks += 1;
    if (ticks * FOLLOW_EVERY_MS > FOLLOW_FOR_MS) {
      stop();
      return;
    }
    void deps
      .locate(false)
      .then((spot) => (spot ? deps.follow(id, spot) : undefined))
      .catch(() => undefined);
  });
  stopFollowing = stop;
  return id;
}

async function reportWithRetries(deps: EmergencyDeps, input: { errandId?: string }) {
  const body = input.errandId ? { errandId: input.errandId } : {};
  for (let attempt = 0; ; attempt += 1) {
    try {
      return (await deps.report(body)).id;
    } catch {
      const pause = REPORT_RETRY_MS[attempt];
      if (pause === undefined) return null;
      await deps.wait(pause);
    }
  }
}

/** The number to dial: the country's, from its settings, or the one most countries answer. */
export const emergencyNumberOf = (settings: { safety?: { emergencyNumber?: string } } | undefined) =>
  settings?.safety?.emergencyNumber ?? '112';
