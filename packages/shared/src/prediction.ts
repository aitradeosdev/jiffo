/**
 * Acceptance prediction (docs/matching.md, M13), as DoorDash ranks with it: each agent's chance of taking an offer,
 * learnt from the offers agents in a state answered lately. A logistic regression over a few things the agent saw
 * when offered: plain, explainable, and fitted the same way from the same history.
 */

/** What an offer looked like to the agent when it was made, kept with the offer for learning from. */
export interface OfferFeatures {
  /** In a straight line to the pickup. */
  pickupKm: number;
  /** Along the errand's stops, pickup to drop-off. */
  tripKm: number;
  feeKobo: number;
  /** Their acceptance rate then (M9); null before it counts. */
  acceptanceRate: number | null;
  /** The hour of day where the errand is, 0 to 23. */
  hour: number;
  /** The agent buys the items. */
  buy: boolean;
}

/** A fitted model: the scaling each input was given, and the weights over them. */
export interface AcceptanceModel {
  means: number[];
  scales: number[];
  weights: number[];
  bias: number;
  /** The answered offers it learnt from. */
  offers: number;
}

/** What the model reads from an offer: distances and the fee on a log scale, the hour round the clock. */
function inputs(f: OfferFeatures, acceptanceWhenUnknown: number): number[] {
  const km = Math.max(0, f.pickupKm) + Math.max(0, f.tripKm);
  const angle = (2 * Math.PI * (((f.hour % 24) + 24) % 24)) / 24;
  return [
    Math.log1p(Math.max(0, f.pickupKm)),
    Math.log1p(Math.max(0, f.tripKm)),
    Math.log1p(Math.max(0, f.feeKobo) / 100),
    Math.log1p(Math.max(0, f.feeKobo) / 100 / Math.max(1, km)),
    f.acceptanceRate ?? acceptanceWhenUnknown,
    Math.sin(angle),
    Math.cos(angle),
    f.buy ? 1 : 0,
  ];
}

const sigmoid = (z: number) => 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z))));

/** The rate taken for an agent whose own rate doesn't count yet: the middle, so it neither helps nor hurts. */
const UNKNOWN_RATE = 0.5;

/**
 * Fits the model to answered offers: each input scaled to the history's spread, then weights by gradient descent
 * with a light penalty on large ones, so a small or lopsided history can't make it extreme.
 */
export function fitAcceptance(
  rows: Array<{ features: OfferFeatures; accepted: boolean }>,
  options: { iterations?: number; learningRate?: number; l2?: number } = {},
): AcceptanceModel {
  const { iterations = 400, learningRate = 0.5, l2 = 0.01 } = options;
  const raw = rows.map((r) => inputs(r.features, UNKNOWN_RATE));
  const width =
    raw[0]?.length ??
    inputs({ pickupKm: 0, tripKm: 0, feeKobo: 0, acceptanceRate: null, hour: 0, buy: false }, 0).length;
  const n = Math.max(1, raw.length);
  const means = Array.from({ length: width }, (_, j) => raw.reduce((s, x) => s + x[j]!, 0) / n);
  const scales = Array.from({ length: width }, (_, j) => {
    const variance = raw.reduce((s, x) => s + (x[j]! - means[j]!) ** 2, 0) / n;
    return variance > 1e-12 ? Math.sqrt(variance) : 1;
  });
  const xs = raw.map((x) => x.map((v, j) => (v - means[j]!) / scales[j]!));
  const ys = rows.map((r) => (r.accepted ? 1 : 0));
  const weights = new Array<number>(width).fill(0);
  let bias = 0;
  for (let step = 0; step < iterations; step++) {
    const grad = new Array<number>(width).fill(0);
    let gradBias = 0;
    xs.forEach((x, i) => {
      const error = sigmoid(bias + x.reduce((s, v, j) => s + v * weights[j]!, 0)) - ys[i]!;
      gradBias += error;
      for (let j = 0; j < width; j++) grad[j]! += error * x[j]!;
    });
    for (let j = 0; j < width; j++) weights[j]! -= learningRate * (grad[j]! / n + l2 * weights[j]!);
    bias -= learningRate * (gradBias / n);
  }
  return { means, scales, weights, bias, offers: rows.length };
}

/** The chance the agent takes this offer, by the model. */
export function predictAcceptance(model: AcceptanceModel, features: OfferFeatures): number {
  const x = inputs(features, UNKNOWN_RATE);
  const z = x.reduce((s, v, j) => s + ((v - model.means[j]!) / model.scales[j]!) * model.weights[j]!, model.bias);
  return sigmoid(z);
}

/** How well the model explains these answers: lower is better; always guessing the share taken is the bar. */
export function logLoss(model: AcceptanceModel, rows: Array<{ features: OfferFeatures; accepted: boolean }>): number {
  if (!rows.length) return 0;
  const eps = 1e-9;
  return (
    -rows.reduce((s, r) => {
      const p = Math.min(1 - eps, Math.max(eps, predictAcceptance(model, r.features)));
      return s + (r.accepted ? Math.log(p) : Math.log(1 - p));
    }, 0) / rows.length
  );
}

/**
 * A ranking score with the chance taken in (Settings, Matching): this share of the score goes by the chance, so an
 * agent unlikely to take it ranks lower. With no model for the state yet, the score is as it was.
 */
export function withPrediction(total: number, chance: number | null, shareBps: number): number {
  if (chance === null || shareBps <= 0) return total;
  const share = shareBps / 10_000;
  return total * (1 - share + share * chance);
}
