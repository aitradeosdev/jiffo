import type { ErrandView, PlacePick, StopView } from './types';

/**
 * A place from a past errand, to use again. It carries no state: whether Jiffo still works there is checked again
 * when the errand is priced, as an area may have been switched off since, and the errand's state is its pickup's.
 */
export const pastPlace = (s: StopView, placeId: string): PlacePick => ({
  placeId,
  name: s.label ?? s.address,
  address: s.address,
  lat: s.lat,
  lng: s.lng,
  stateCode: null,
  areaId: null,
});

/** The last two different places from past errands, kept as the kind of stop they were. */
export function recentPlaces(errands: ErrandView[]) {
  const seen = new Set<string>();
  const out: Array<{ kind: 'pickup' | 'dropoff'; place: PlacePick }> = [];
  for (const e of errands) {
    for (const s of [...e.stops].reverse()) {
      if (s.kind === 'stop' || seen.has(s.address)) continue;
      seen.add(s.address);
      out.push({ kind: s.kind, place: pastPlace(s, `recent:${s.lat},${s.lng}`) });
      if (out.length === 2) return out;
    }
  }
  return out;
}
