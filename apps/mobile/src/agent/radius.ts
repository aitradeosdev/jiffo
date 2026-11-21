/** Distances an agent can pick for how far they will travel, in km, before Jiffo's own reach. */
const STEPS = [2, 5, 10, 20, 30];

/**
 * The work radius choices, given how far Jiffo allows (Settings, Matching): the steps below it, with the
 * agent's saved radius in its place if it is none of them, then null for as far as Jiffo allows.
 */
export function radiusChoices(allowedKm: number, savedKm: number | null = null): Array<number | null> {
  const below = new Set(STEPS.filter((km) => km < allowedKm));
  if (savedKm !== null && savedKm < allowedKm) below.add(savedKm);
  return [...[...below].sort((a, b) => a - b), null];
}

/** The choice to show as picked: a saved radius Jiffo allows now, else Jiffo's own reach. */
export const radiusChosen = (savedKm: number | null, allowedKm: number) =>
  savedKm !== null && savedKm < allowedKm ? savedKm : null;

/**
 * A saved radius past what Jiffo allows now works as Jiffo's reach, but still counts if Jiffo allows more
 * later: said, so the agent isn't surprised.
 */
export const radiusNote = (savedKm: number | null, allowedKm: number) =>
  savedKm !== null && savedKm > allowedKm
    ? `You chose ${savedKm} km. Jiffo reaches up to ${allowedKm} km for now.`
    : null;

export const reachLabel = (km: number | null, allowedKm: number) =>
  km === null ? `Up to ${allowedKm} km` : `${km} km`;
