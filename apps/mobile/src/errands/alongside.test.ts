import { describe, expect, it } from 'vitest';
import { nextStop, stopLines, type Alongside } from './alongside';

const alongside: Alongside = {
  errandId: 'other',
  stops: [
    { errandId: 'mine', kind: 'pickup', label: 'Shop', address: 'Ring Road', lat: 6.3, lng: 5.6, done: false },
    { errandId: 'other', kind: 'pickup', label: null, address: 'Sapele Road', lat: 6.31, lng: 5.61, done: false },
    { errandId: 'mine', kind: 'dropoff', label: 'Home', address: 'GRA', lat: 6.33, lng: 5.65, done: false },
    { errandId: 'other', kind: 'dropoff', label: 'Office', address: 'Airport Road', lat: 6.34, lng: 5.66, done: false },
  ],
};

/** Two errands at once (docs/matching.md, M13): the agent's stops through both, in order. */
describe('the stops of two errands at once', () => {
  it('numbers each stop in order, saying which errand it is for', () => {
    expect(stopLines(alongside, 'mine')).toEqual([
      { n: 1, title: 'Pick up: Shop', address: 'Ring Road', mine: true, errandId: 'mine', done: false },
      {
        n: 2,
        title: 'Pick up for the other errand',
        address: 'Sapele Road',
        mine: false,
        errandId: 'other',
        done: false,
      },
      { n: 3, title: 'Drop off: Home', address: 'GRA', mine: true, errandId: 'mine', done: false },
      {
        n: 4,
        title: 'Drop off for the other errand: Office',
        address: 'Airport Road',
        mine: false,
        errandId: 'other',
        done: false,
      },
    ]);
  });

  it("marks an errand's stops done once it is delivered", () => {
    const done = { ...alongside, stops: alongside.stops.map((s) => ({ ...s, done: s.errandId === 'mine' })) };
    expect(stopLines(done, 'other').map((l) => [l.n, l.mine, l.done])).toEqual([
      [1, false, true],
      [2, true, false],
      [3, false, true],
      [4, true, false],
    ]);
  });

  it('heads for the first stop not done yet, whichever errand it is for', () => {
    expect(nextStop(alongside)).toEqual({ lat: 6.3, lng: 5.6 });
    const first = { ...alongside, stops: alongside.stops.map((s, i) => ({ ...s, done: i === 0 })) };
    expect(nextStop(first)).toEqual({ lat: 6.31, lng: 5.61 });
    expect(nextStop({ ...alongside, stops: alongside.stops.map((s) => ({ ...s, done: true })) })).toBeNull();
  });
});
