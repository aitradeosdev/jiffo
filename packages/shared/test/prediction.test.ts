import { describe, expect, it } from 'vitest';
import { fitAcceptance, logLoss, predictAcceptance, withPrediction, type OfferFeatures } from '../src/prediction';
import { NIGERIA_DEFAULT_SETTINGS } from '../src/settings';

const offer = (over: Partial<OfferFeatures> = {}): OfferFeatures => ({
  pickupKm: 2,
  tripKm: 5,
  feeKobo: 300_000,
  acceptanceRate: 0.8,
  hour: 12,
  buy: false,
  ...over,
});

/**
 * A made-up history: agents take offers whose pickup is near and that pay well, and turn down far ones and those
 * that pay little; a few go against the pattern, as people do.
 */
function history(n: number) {
  const rows: Array<{ features: OfferFeatures; accepted: boolean }> = [];
  for (let i = 0; i < n; i++) {
    const pickupKm = (i % 10) + 0.5;
    const feeKobo = 150_000 + ((i * 7) % 10) * 50_000;
    const likely = pickupKm < 5 && feeKobo >= 250_000;
    rows.push({ features: offer({ pickupKm, feeKobo, hour: i % 24 }), accepted: i % 11 === 0 ? !likely : likely });
  }
  return rows;
}

/** Acceptance prediction (docs/matching.md, M13), as DoorDash ranks with it: each agent's chance of taking an offer. */
describe('acceptance prediction', () => {
  it('learns from answered offers which ones agents take', () => {
    const model = fitAcceptance(history(600));
    expect(model.offers).toBe(600);
    const near = predictAcceptance(model, offer({ pickupKm: 1, feeKobo: 450_000 }));
    const far = predictAcceptance(model, offer({ pickupKm: 9, feeKobo: 150_000 }));
    expect(near).toBeGreaterThan(0.6);
    expect(far).toBeLessThan(0.4);
    // Better than knowing nothing: the log loss of always guessing the share taken.
    const rows = history(600);
    const share = rows.filter((r) => r.accepted).length / rows.length;
    const guess = -(share * Math.log(share) + (1 - share) * Math.log(1 - share));
    expect(logLoss(model, rows)).toBeLessThan(guess);
  });

  it('gives the same model for the same history, and a chance between 0 and 1 for any offer', () => {
    expect(fitAcceptance(history(200))).toEqual(fitAcceptance(history(200)));
    const model = fitAcceptance(history(200));
    for (const o of [offer({ pickupKm: 0 }), offer({ pickupKm: 500, feeKobo: 0 }), offer({ acceptanceRate: null })]) {
      const p = predictAcceptance(model, o);
      expect(p).toBeGreaterThan(0);
      expect(p).toBeLessThan(1);
    }
  });

  it('scales a ranking score by the chance, by the share admin sets, and leaves it alone with none', () => {
    expect(withPrediction(0.8, null, 2_000)).toBe(0.8);
    expect(withPrediction(0.8, 1, 2_000)).toBeCloseTo(0.8);
    expect(withPrediction(0.8, 0, 2_000)).toBeCloseTo(0.64);
    expect(withPrediction(0.8, 0.5, 0)).toBe(0.8);
  });

  it('starts with a fifth of the score, once a state has 500 answered offers', () => {
    expect(NIGERIA_DEFAULT_SETTINGS.matching).toMatchObject({ predictionShareBps: 2_000, predictionMinOffers: 500 });
  });
});
