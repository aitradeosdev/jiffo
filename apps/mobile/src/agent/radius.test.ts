import { describe, expect, it } from 'vitest';
import { radiusChoices, radiusChosen, radiusNote, reachLabel } from './radius';

/** How far an agent will travel to a pickup (Preferences), within how far Jiffo allows. */
describe('work radius', () => {
  it('offers the distances below what Jiffo allows, and Jiffo’s own reach', () => {
    expect(radiusChoices(10)).toEqual([2, 5, null]);
    expect(radiusChoices(20)).toEqual([2, 5, 10, null]);
    expect(radiusChoices(3)).toEqual([2, null]);
    expect(radiusChoices(1)).toEqual([null]);
  });

  it('offers a saved radius that is none of the steps, in its place', () => {
    expect(radiusChoices(10, 3)).toEqual([2, 3, 5, null]);
    expect(radiusChoices(10, 8)).toEqual([2, 5, 8, null]);
    expect(radiusChoices(10, 5)).toEqual([2, 5, null]);
    // Past what Jiffo allows now: it works as Jiffo's reach (radiusNote says so).
    expect(radiusChoices(10, 20)).toEqual([2, 5, null]);
  });

  it('picks the saved radius, or Jiffo’s own reach when it is past what Jiffo allows now', () => {
    expect(radiusChosen(5, 10)).toBe(5);
    expect(radiusChosen(8, 10)).toBe(8);
    expect(radiusChosen(null, 10)).toBeNull();
    expect(radiusChosen(20, 10)).toBeNull();
    expect(radiusChosen(10, 10)).toBeNull();
  });

  it('says when a saved radius is past what Jiffo allows now, as it still counts if Jiffo allows more later', () => {
    expect(radiusNote(20, 10)).toBe('You chose 20 km. Jiffo reaches up to 10 km for now.');
    expect(radiusNote(10, 10)).toBeNull();
    expect(radiusNote(5, 10)).toBeNull();
    expect(radiusNote(null, 10)).toBeNull();
  });

  it('names each choice', () => {
    expect(reachLabel(5, 10)).toBe('5 km');
    expect(reachLabel(null, 10)).toBe('Up to 10 km');
  });
});
