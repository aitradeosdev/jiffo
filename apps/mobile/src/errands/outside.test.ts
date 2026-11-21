import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/client';
import { outsideMessage, outsideStops } from './outside';

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

  it('names each place once', () => {
    expect(outsideMessage(stops, [2, 2])).toBe(
      "Jiffo doesn't work at Home yet. Change it to a place where Jiffo works.",
    );
    expect(outsideMessage([{ name: 'Home' }, { name: 'Home' }], [0, 1])).toBe(
      "Jiffo doesn't work at Home yet. Change it to a place where Jiffo works.",
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

/** Which stops a refused quote says are outside: null when it was refused for another reason. */
describe('a quote refused outside the areas', () => {
  const outside = (details: Record<string, unknown>) =>
    new ApiError(422, 'outside_service_area', "Jiffo doesn't work there yet", details);

  it('gives the stops the server named, each once and in order', () => {
    expect(outsideStops(outside({ stops: [2, 0, 2] }), 3)).toEqual([0, 2]);
  });

  it('is still outside when the server named none, or none of these stops', () => {
    expect(outsideStops(outside({}), 3)).toEqual([]);
    expect(outsideStops(outside({ stops: 'all' }), 3)).toEqual([]);
    expect(outsideStops(outside({ stops: [5, -1, 1.5, '1'] }), 3)).toEqual([]);
  });

  it('is not about the areas for any other refusal', () => {
    expect(outsideStops(new ApiError(503, 'maps_unavailable', 'Try again'), 3)).toBeNull();
    expect(outsideStops(new Error('offline'), 3)).toBeNull();
  });
});
