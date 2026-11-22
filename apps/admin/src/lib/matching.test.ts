import { describe, expect, it } from 'vitest';
import { duration, OFFER_STATUS, partsText, share } from './matching';

/** How the matching dashboard and offer log say their figures (docs/matching.md, M15). */
describe('matching figures', () => {
  it('says a time in seconds, minutes or hours, and a dash with none to go by', () => {
    expect(duration(0)).toBe('0 s');
    expect(duration(45)).toBe('45 s');
    expect(duration(90)).toBe('1 min 30 s');
    expect(duration(600)).toBe('10 min');
    expect(duration(3_900)).toBe('1 h 5 min');
    expect(duration(null)).toBe('—');
  });

  it('says a share or a rate as a whole percentage', () => {
    expect(share(0.25)).toBe('25%');
    expect(share(1 / 3)).toBe('33%');
    expect(share(null)).toBe('—');
  });

  it("says an offer's score parts in points out of 100", () => {
    expect(partsText({ travel: 0.42, reliability: 0.18, rating: 0.1, waiting: 0.05, boost: 0, total: 0.75 })).toBe(
      'travel 42 · reliability 18 · rating 10 · waiting 5',
    );
    expect(partsText({ travel: 0.5, boost: 0.1, total: 0.6 })).toBe('travel 50 · boost 10');
  });

  it('names what became of each offer', () => {
    expect(OFFER_STATUS.declined.label).toBe('Declined');
    expect(OFFER_STATUS.accepted.tone).toBe('brand');
  });
});
