import { describe, expect, it } from 'vitest';
import {
  allowedEvents,
  canRevealPin,
  ERRAND_EVENTS,
  ERRAND_STATES,
  nextState,
  TERMINAL_STATES,
  TransitionError,
  type Actor,
  type ErrandState,
  type TransitionContext,
} from '../src/errands';

const ctx = (actor: Actor, over: Partial<TransitionContext> = {}): TransitionContext => ({
  actor,
  buy: true,
  pendingOffer: false,
  ...over,
});

function run(steps: Array<[string, Actor, Partial<TransitionContext>?]>, start: ErrandState = 'requested', buy = true) {
  return steps.reduce<ErrandState>(
    (state, [event, actor, over]) => nextState(state, event, ctx(actor, { buy, ...over })),
    start,
  );
}

function expectError(fn: () => unknown, code: TransitionError['code']) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(TransitionError);
    expect((e as TransitionError).code).toBe(code);
    return;
  }
  throw new Error('expected a TransitionError');
}

describe('errand lifecycle: happy paths', () => {
  it('runs a purchase errand to completion with the PIN', () => {
    const end = run([
      ['accept', 'agent'],
      ['start', 'agent'],
      ['send_item_amount', 'agent'],
      ['lock_item_amount', 'customer'],
      ['mark_delivered', 'agent'],
      ['confirm_pin', 'agent'],
    ]);
    expect(end).toBe('completed');
  });

  it('runs an errand without a purchase straight from Start service to delivered', () => {
    const end = run(
      [
        ['accept', 'agent'],
        ['start', 'agent'],
        ['mark_delivered', 'agent'],
        ['send_dropoff_photo', 'agent'],
        ['approve_photo', 'customer'],
      ],
      'requested',
      false,
    );
    expect(end).toBe('completed');
  });

  it('releases a drop-off photo automatically after the wait', () => {
    expect(nextState('photo_pending', 'auto_release', ctx('system'))).toBe('completed');
  });
});

describe('new prices before Start service', () => {
  it('lets the agent send a new price only while accepted', () => {
    expect(nextState('accepted', 'send_offer', ctx('agent'))).toBe('accepted');
    expectError(() => nextState('started', 'send_offer', ctx('agent')), 'invalid_state');
  });

  it('allows only one new price at a time', () => {
    expectError(() => nextState('accepted', 'send_offer', ctx('agent', { pendingOffer: true })), 'blocked');
  });

  it('blocks Start service while a new price waits for an answer', () => {
    expectError(() => nextState('accepted', 'start', ctx('agent', { pendingOffer: true })), 'blocked');
  });

  it('lets the customer answer only when a new price is waiting', () => {
    expect(nextState('accepted', 'accept_offer', ctx('customer', { pendingOffer: true }))).toBe('accepted');
    expect(nextState('accepted', 'decline_offer', ctx('customer', { pendingOffer: true }))).toBe('accepted');
    expectError(() => nextState('accepted', 'accept_offer', ctx('customer')), 'blocked');
  });

  it('sends the errand back to matching when the customer gets a new agent', () => {
    expect(nextState('accepted', 'release_agent', ctx('customer'))).toBe('requested');
  });
});

describe('purchase rules', () => {
  it('refuses an item amount on an errand without a purchase', () => {
    expectError(() => nextState('started', 'send_item_amount', ctx('agent', { buy: false })), 'blocked');
  });

  it('refuses Mark delivered on a purchase errand before the item amount is locked', () => {
    expectError(() => nextState('started', 'mark_delivered', ctx('agent', { buy: true })), 'blocked');
  });

  it('sends an unlocked item amount to admin when the lock window runs out', () => {
    expect(nextState('item_pending', 'item_lock_timeout', ctx('system'))).toBe('disputed');
  });
});

describe('who may do what', () => {
  it('lets only an agent accept, and never the customer', () => {
    expectError(() => nextState('requested', 'accept', ctx('customer')), 'not_allowed');
  });

  it('lets only the customer lock the item amount and approve the photo', () => {
    expectError(() => nextState('item_pending', 'lock_item_amount', ctx('agent')), 'not_allowed');
    expectError(() => nextState('photo_pending', 'approve_photo', ctx('agent')), 'not_allowed');
  });

  it('keeps disputes resolvable only by admin', () => {
    expectError(() => nextState('disputed', 'resolve_complete', ctx('customer')), 'not_allowed');
    expect(nextState('disputed', 'resolve_cancel', ctx('admin'))).toBe('cancelled');
  });

  it('rejects unknown events', () => {
    expectError(() => nextState('requested', 'teleport', ctx('agent')), 'unknown_event');
  });
});

describe('unreachable customers', () => {
  it('redelivers to the right state for each kind of errand', () => {
    expect(nextState('unreachable', 'redeliver', ctx('customer', { buy: true }))).toBe('items_locked');
    expect(nextState('unreachable', 'redeliver', ctx('customer', { buy: false }))).toBe('started');
  });

  it('lets admin step in at any point', () => {
    expect(nextState('unreachable', 'admin_intervene', ctx('admin'))).toBe('disputed');
  });
});

describe('structure', () => {
  it('lets nothing leave a finished errand', () => {
    for (const state of TERMINAL_STATES) {
      for (const actor of ['customer', 'agent', 'system', 'admin'] as const) {
        expect(allowedEvents(state, ctx(actor))).toEqual([]);
      }
    }
  });

  it('only uses known states in the rules', () => {
    for (const rule of Object.values(ERRAND_EVENTS)) {
      for (const s of rule.from) expect(ERRAND_STATES).toContain(s);
      if (typeof rule.to === 'string') expect(ERRAND_STATES).toContain(rule.to);
    }
  });

  it('shows the agent the right actions after accepting', () => {
    expect(allowedEvents('accepted', ctx('agent'))).toEqual(['withdraw', 'send_offer', 'start']);
    expect(allowedEvents('accepted', ctx('agent', { pendingOffer: true }))).toEqual(['withdraw']);
  });

  it('reveals the PIN only after the agent marks the errand delivered', () => {
    expect(ERRAND_STATES.filter(canRevealPin)).toEqual(['delivered']);
  });
});
