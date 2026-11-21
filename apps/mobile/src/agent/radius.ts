/** Distances an agent can pick for how far they will travel, in km, before Jiffo's own reach. */
const STEPS = [2, 5, 10, 20, 30];

/**
 * The work radius choices, given how far Jiffo allows (Settings, Matching): the steps below it, then null for
 * as far as Jiffo allows.
 */
export const radiusChoices = (allowedKm: number): Array<number | null> => [
  ...STEPS.filter((km) => km < allowedKm),
  null,
];

/** The choice to show as picked: a saved radius Jiffo allows now, else Jiffo's own reach. */
export const radiusChosen = (savedKm: number | null, allowedKm: number) =>
  savedKm !== null && savedKm < allowedKm ? savedKm : null;

export const reachLabel = (km: number | null, allowedKm: number) =>
  km === null ? `Up to ${allowedKm} km` : `${km} km`;
