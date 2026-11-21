import { describe, expect, it } from 'vitest';
import { outsideMessage } from './outside';

/** What the customer is told when a stop is outside the areas where Jiffo works, naming it. */
describe('stops outside the areas', () => {
  const stops = [{ name: 'Shoprite Lekki' }, { name: 'Ikorodu Garage' }, { name: 'Home' }];

  it('names the stop, or the stops, that are outside', () => {
    expect(outsideMessage(stops, [1])).toBe(
      "Jiffo doesn't work at Ikorodu Garage yet. Change it to a place where Jiffo works.",
    );
    expect(outsideMessage(stops, [0, 2])).toBe(
      "Jiffo doesn't work at Shoprite Lekki or Home yet. Change them to places where Jiffo works.",
    );
  });

  it('says so in general when it is not known which', () => {
    expect(outsideMessage(stops, [])).toBe(
      "Jiffo doesn't work there yet. Change the stops to places where Jiffo works.",
    );
    expect(outsideMessage(stops, [7])).toBe(
      "Jiffo doesn't work there yet. Change the stops to places where Jiffo works.",
    );
  });
});
