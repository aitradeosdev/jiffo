import { describe, expect, it } from 'vitest';
import { customerLine, isOfferPush, offerEndsAt, offerFacts, offlineMessage, secondsToGo, type Offer } from './offer';

const offer: Offer = {
  id: 'offer-1',
  expiresAt: '2026-11-21T10:00:20.000Z',
  secondsLeft: 20,
  agentEarnsKobo: 212_500,
  errand: {
    id: 'errand-1',
    categoryKey: 'parcel',
    feeKobo: 250_000,
    buy: false,
    urgent: true,
    stopCount: 2,
    scheduledFor: null,
  },
  pickup: { area: 'Awoyaya, Lagos', km: 1.2 },
  dropoff: { area: 'Lekki Phase 1, Lagos', km: 9.8 },
  customer: { firstName: 'Ada', lastInitial: 'O', verified: true, rating: 4.8, completedErrands: 12 },
};

/** An urgent errand offered to this agent alone, ringing, for a short time (docs/matching.md, M6). */
describe('an offer', () => {
  it("counts down from the server's seconds left, not the phone's clock", () => {
    // The phone's clock is two minutes slow: the offer still gets its 20 seconds.
    const received = Date.parse('2026-11-21T09:58:00.000Z');
    const ends = offerEndsAt(offer, received);
    expect(secondsToGo(ends, received)).toBe(20);
    expect(secondsToGo(ends, received + 500)).toBe(20);
    expect(secondsToGo(ends, received + 1_000)).toBe(19);
    expect(secondsToGo(ends, received + 19_001)).toBe(1);
    expect(secondsToGo(ends, received + 20_000)).toBe(0);
    expect(secondsToGo(ends, received + 60_000)).toBe(0);
  });

  it('says who the customer is without their full name', () => {
    expect(customerLine(offer.customer)).toBe('Ada O. · Verified · 4.8 ★ · 12 errands');
    expect(
      customerLine({ firstName: 'Ada', lastInitial: null, verified: false, rating: null, completedErrands: 1 }),
    ).toBe('Ada · 1 errand');
    expect(
      customerLine({ firstName: null, lastInitial: null, verified: false, rating: null, completedErrands: 0 }),
    ).toBe('A new customer');
  });

  it('lists what the errand involves', () => {
    expect(offerFacts(offer)).toEqual(['Now', '2 stops']);
    expect(offerFacts({ ...offer, errand: { ...offer.errand, buy: true, stopCount: 3 } })).toEqual([
      'Now',
      '3 stops',
      'You buy the items',
    ]);
    expect(offerFacts({ ...offer, errand: { ...offer.errand, scheduledFor: '2026-11-21T15:00:00.000Z' } })[0]).toMatch(
      /^Scheduled/,
    );
  });

  it('knows an offer push from any other', () => {
    expect(isOfferPush({ type: 'errand.offer', offerId: 'offer-1' })).toBe(true);
    expect(isOfferPush({ type: 'errand.updated' })).toBe(false);
    expect(isOfferPush(null)).toBe(false);
    expect(isOfferPush('errand.offer')).toBe(false);
  });

  it('says why Jiffo took the agent offline', () => {
    expect(offlineMessage('missed_offers')).toMatch(/missed .*offers in a row/i);
    expect(offlineMessage(null)).toBeNull();
    expect(offlineMessage(undefined)).toBeNull();
    // A reason this app doesn't know yet still tells them they're offline.
    expect(offlineMessage('something_new')).toMatch(/offline/i);
  });
});
