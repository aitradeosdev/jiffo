import { describe, expect, it } from 'vitest';
import { raisePromptDue, waitingCopy } from './waiting';

const urgent = { urgent: true, offers: true, scheduled: null, pickupLabel: 'Shop' } as const;

/** What the customer reads while their errand waits for an agent. */
describe('waiting for an agent', () => {
  it('says urgent errands are asked of the nearest agents in turn, and how far the search reaches (M6, M8)', () => {
    expect(waitingCopy({ ...urgent, search: { radiusKm: 3, everyone: false } })).toEqual({
      title: 'Finding the nearest agent',
      sub: 'Asking the nearest free agents one at a time, within 3 km. It goes to the first who accepts.',
    });
    expect(waitingCopy({ ...urgent, search: { radiusKm: 10, everyone: true } })).toEqual({
      title: 'Finding the nearest agent',
      sub: 'Every free agent within 10 km can take it now. It goes to the first who accepts.',
    });
    // An older server that doesn't say: offers are on to start, and no reach is shown.
    expect(waitingCopy({ ...urgent, offers: undefined, search: undefined }).sub).toBe(
      'Asking the nearest free agents one at a time. It goes to the first who accepts.',
    );
  });

  it('says the first to accept gets it where offers are off, as urgent errands are then on the board', () => {
    expect(waitingCopy({ ...urgent, offers: false, search: null })).toEqual({
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

/** After a while with no agent, the customer is asked to raise the fee or keep waiting (M8). */
describe('the prompt to raise the fee', () => {
  const timers = { raisePricePromptMinutes: 15, boardRaisePromptMinutes: 30 };
  const sent = Date.parse('2026-11-21T10:00:00.000Z');
  const at = (minutes: number) => sent + minutes * 60_000;
  const errand = { createdAt: new Date(sent).toISOString(), urgent: true, feeRaised: false };

  it('comes after the urgent wait for an urgent errand, and the longer one for a board errand', () => {
    expect(raisePromptDue(errand, null, timers, at(14))).toBe(false);
    expect(raisePromptDue(errand, null, timers, at(15))).toBe(true);
    expect(raisePromptDue({ ...errand, urgent: false }, null, timers, at(20))).toBe(false);
    expect(raisePromptDue({ ...errand, urgent: false }, null, timers, at(30))).toBe(true);
  });

  it('never comes once the fee was raised, for one scheduled ahead, or without the settings', () => {
    expect(raisePromptDue({ ...errand, feeRaised: true }, null, timers, at(40))).toBe(false);
    expect(raisePromptDue(errand, '2026-11-21T18:00:00.000Z', timers, at(40))).toBe(false);
    expect(raisePromptDue(errand, null, undefined, at(40))).toBe(false);
  });
});
