import { describe, expect, it } from 'vitest';
import { radiusChoices, radiusChosen, reachLabel } from './radius';

/** How far an agent will travel to a pickup (Preferences), within how far Jiffo allows. */
describe('work radius', () => {
  it('offers the distances below what Jiffo allows, and Jiffo’s own reach', () => {
    expect(radiusChoices(10)).toEqual([2, 5, null]);
    expect(radiusChoices(20)).toEqual([2, 5, 10, null]);
    expect(radiusChoices(3)).toEqual([2, null]);
    expect(radiusChoices(1)).toEqual([null]);
  });

  it('shows a saved radius past what Jiffo allows now as Jiffo’s own reach', () => {
    expect(radiusChosen(5, 10)).toBe(5);
    expect(radiusChosen(null, 10)).toBeNull();
    expect(radiusChosen(20, 10)).toBeNull();
    expect(radiusChosen(10, 10)).toBeNull();
  });

  it('names each choice', () => {
    expect(reachLabel(5, 10)).toBe('5 km');
    expect(reachLabel(null, 10)).toBe('Up to 10 km');
  });
});
