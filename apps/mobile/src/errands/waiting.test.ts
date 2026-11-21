import { describe, expect, it } from 'vitest';
import { waitingCopy } from './waiting';

/** What the customer reads while their errand waits for an agent. */
describe('waiting for an agent', () => {
  it('says urgent errands are asked of the nearest agents in turn, where they are (docs/matching.md, M6)', () => {
    expect(waitingCopy({ urgent: true, offers: true, scheduled: null, pickupLabel: 'Shop' })).toEqual({
      title: 'Finding the nearest agent',
      sub: 'The nearest free agents are asked one at a time. It goes to the first who accepts.',
    });
    // An older server that doesn't say: offers are on to start.
    expect(waitingCopy({ urgent: true, offers: undefined, scheduled: null, pickupLabel: 'Shop' }).sub).toMatch(
      /one at a time/,
    );
  });

  it('says the first to accept gets it where offers are off, as urgent errands are then on the board', () => {
    expect(waitingCopy({ urgent: true, offers: false, scheduled: null, pickupLabel: 'Shop' })).toEqual({
      title: 'Finding the nearest agent',
      sub: 'Agents nearby can see it. The first to accept gets it.',
    });
  });

  it('says where an errand from the board can be seen, and when a scheduled one goes on it', () => {
    expect(waitingCopy({ urgent: false, offers: true, scheduled: null, pickupLabel: 'Shoprite' })).toEqual({
      title: 'Finding your agent',
      sub: 'Agents near Shoprite can see it and accept.',
    });
    expect(waitingCopy({ urgent: false, offers: true, scheduled: null, pickupLabel: null }).sub).toBe(
      'Agents near your pickup can see it and accept.',
    );
    const later = waitingCopy({
      urgent: false,
      offers: true,
      scheduled: '2026-11-22T15:00:00.000Z',
      pickupLabel: 'Shop',
    });
    expect(later.title).toMatch(/^Scheduled for /);
    expect(later.sub).toBe('It goes on the board ahead of time, so an agent can accept it early.');
  });
});
