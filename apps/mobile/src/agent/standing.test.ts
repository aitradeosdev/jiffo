import { describe, expect, it } from 'vitest';
import { pausedNote, standingFigures } from './standing';

/** How the agent stands (docs/matching.md, M9), beside their rating on the account screen. */
describe("the agent's standing", () => {
  it('shows the acceptance rate, completion rate and errands left this week', () => {
    expect(
      standingFigures({ acceptanceRate: 0.923, completionRate: 0.98, cancellations7d: 1, offersPausedUntil: null }),
    ).toEqual([
      { value: '92%', label: 'Acceptance' },
      { value: '98%', label: 'Completion' },
      { value: '1', label: 'Left this week' },
    ]);
    // With nothing counted yet.
    expect(
      standingFigures({ acceptanceRate: null, completionRate: null, cancellations7d: 0, offersPausedUntil: null }),
    ).toEqual([
      { value: 'New', label: 'Acceptance' },
      { value: 'New', label: 'Completion' },
      { value: '0', label: 'Left this week' },
    ]);
  });

  it('says when offers are paused, and until when, while they are', () => {
    const now = Date.parse('2026-11-21T13:00:00.000Z');
    const note = pausedNote('2026-11-21T13:30:00.000Z', now);
    expect(note).toMatch(/^Offers are paused until .+ for a low acceptance rate\. The board still works\.$/);
    expect(pausedNote('2026-11-21T12:30:00.000Z', now)).toBeNull();
    expect(pausedNote(null, now)).toBeNull();
  });
});
