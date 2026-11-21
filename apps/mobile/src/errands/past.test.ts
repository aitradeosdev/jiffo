import { describe, expect, it } from 'vitest';
import { pastPlace, recentPlaces } from './past';
import type { ErrandView, StopView } from './types';

const stop = (seq: number, kind: StopView['kind'], address: string): StopView => ({
  seq,
  kind,
  label: address.split(',')[0]!,
  address,
  lat: [6.43, 6.61, 6.52][seq]!,
  lng: [3.47, 3.38, 3.36][seq]!,
});

const errand = (id: string, stops: StopView[]) => ({ id, stateCode: 'LA', stops }) as unknown as ErrandView;

/**
 * Places from past errands are used again (recent places, "Request it again"). Whether Jiffo still works there is
 * checked again when the errand is priced, so none of them carries a state: an area may have been switched off
 * since, and the errand's state is its pickup's, not its drop-off's.
 */
describe('places from past errands', () => {
  it('keep the place, without a state of their own', () => {
    const e = errand('e1', [stop(0, 'pickup', 'Shoprite Lekki, Lagos'), stop(1, 'dropoff', 'Ikorodu Garage, Lagos')]);
    expect(pastPlace(e.stops[1]!, 'errand:e1:1')).toEqual({
      placeId: 'errand:e1:1',
      name: 'Ikorodu Garage',
      address: 'Ikorodu Garage, Lagos',
      lat: 6.61,
      lng: 3.38,
      stateCode: null,
      areaId: null,
    });
  });

  it('give the last two different places, as the kind of stop they were', () => {
    const recent = recentPlaces([
      errand('e2', [stop(0, 'pickup', 'Shoprite Lekki, Lagos'), stop(1, 'dropoff', 'Home, Lagos')]),
      errand('e1', [
        stop(0, 'pickup', 'Home, Lagos'),
        stop(1, 'stop', 'Pharmacy, Lagos'),
        stop(2, 'dropoff', 'Office, Lagos'),
      ]),
    ]);
    expect(recent.map((r) => [r.kind, r.place.name, r.place.stateCode])).toEqual([
      ['dropoff', 'Home', null],
      ['pickup', 'Shoprite Lekki', null],
    ]);
  });
});
