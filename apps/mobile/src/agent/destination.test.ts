import { describe, expect, it } from 'vitest';
import { destinationChip, destinationNote, type DestinationStatus } from './destination';

const none: DestinationStatus = { enabled: true, destination: null, usesPerDay: 2, usesLeft: 2 };
const home: DestinationStatus = {
  enabled: true,
  destination: { lat: 6.5, lng: 3.5, label: 'Home', setAt: '2026-11-22T08:00:00Z' },
  usesPerDay: 2,
  usesLeft: 1,
};

/** Destination mode on the agent's board (docs/matching.md, M13). */
describe('destination mode', () => {
  it('names the chip by where they are heading, or offers to set one', () => {
    expect(destinationChip(none)).toBe('Heading somewhere?');
    expect(destinationChip(home)).toBe('To Home');
    // Off where they work: no chip.
    expect(destinationChip({ ...none, enabled: false })).toBeNull();
    expect(destinationChip(null)).toBeNull();
  });

  it('says how many are left today, and what it does', () => {
    expect(destinationNote(none)).toBe(
      "Set where you're heading, such as home, to see only errands that take you closer. 2 of 2 left today.",
    );
    expect(destinationNote(home)).toBe(
      'Only errands that take you closer to Home. It ends when you get there. 1 of 2 left today.',
    );
    expect(destinationNote({ ...none, usesLeft: 0 })).toMatch(/None left today/);
  });
});
