/** The errand this one is carried with (docs/matching.md, M13), and the way through both errands' stops. */
export interface Alongside {
  errandId: string;
  stops: Array<{
    errandId: string;
    kind: 'pickup' | 'dropoff';
    label: string | null;
    address: string;
    lat: number;
    lng: number;
    /** Its errand is delivered: both its stops are behind the agent. */
    done: boolean;
  }>;
}

export interface StopLine {
  n: number;
  title: string;
  address: string;
  /** For the errand on screen; the other's opens that one. */
  mine: boolean;
  errandId: string;
  done: boolean;
}

/** The stops through both errands, numbered in the order to take them, each saying which errand it is for. */
export function stopLines(alongside: Alongside, errandId: string): StopLine[] {
  return alongside.stops.map((s, i) => {
    const mine = s.errandId === errandId;
    const what = s.kind === 'pickup' ? 'Pick up' : 'Drop off';
    const title = mine
      ? `${what}${s.label ? `: ${s.label}` : ''}`
      : `${what} for the other errand${s.label ? `: ${s.label}` : ''}`;
    return { n: i + 1, title, address: s.address, mine, errandId: s.errandId, done: s.done };
  });
}

/** Where to head next through both errands: the first stop not behind the agent yet. */
export function nextStop(alongside: Alongside): { lat: number; lng: number } | null {
  const next = alongside.stops.find((s) => !s.done);
  return next ? { lat: next.lat, lng: next.lng } : null;
}
