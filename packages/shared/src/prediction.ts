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
  /** Which inputs it reads ({@link MODEL_VERSION}): a model kept from before they changed gives no chance. */
  version: number;
  means: number[];
  scales: number[];
  weights: number[];
  bias: number;
  /** The rate taken for an agent whose own doesn't count yet: the history's average, so it neither helps nor hurts. */
  unknownRate: number;
  /** The answered offers it learnt from. */
  offers: number;
}

/** Bumped whenever {@link inputs} changes, so models kept from before are no longer used. */
export const MODEL_VERSION = 1;

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

const WIDTH = inputs({ pickupKm: 0, tripKm: 0, feeKobo: 0, acceptanceRate: null, hour: 0, buy: false }, 0).length;

/**
 * Fits the model to answered offers: each input scaled to the history's spread, then weights by gradient descent
 * with a light penalty on large ones, so a small or lopsided history can't make it extreme.
 */
export function fitAcceptance(
  rows: Array<{ features: OfferFeatures; accepted: boolean }>,
  options: { iterations?: number; learningRate?: number; l2?: number } = {},
): AcceptanceModel {
  const { iterations = 400, learningRate = 0.5, l2 = 0.01 } = options;
  const known = rows.filter((r) => r.features.acceptanceRate !== null);
  const unknownRate = known.length ? known.reduce((s, r) => s + r.features.acceptanceRate!, 0) / known.length : 0.5;
  const n = rows.length;
  const width = WIDTH;
  // One flat array, row after row: the fit loops over it hundreds of times.
  const xs = new Float64Array(n * width);
  rows.forEach((r, i) => xs.set(inputs(r.features, unknownRate), i * width));
  const means = new Array<number>(width).fill(0);
  const scales = new Array<number>(width).fill(1);
  for (let j = 0; j < width; j++) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += xs[i * width + j]!;
    const mean = n ? sum / n : 0;
    let squares = 0;
    for (let i = 0; i < n; i++) squares += (xs[i * width + j]! - mean) ** 2;
    const variance = n ? squares / n : 0;
    means[j] = mean;
    scales[j] = variance > 1e-12 ? Math.sqrt(variance) : 1;
    for (let i = 0; i < n; i++) xs[i * width + j] = (xs[i * width + j]! - mean) / scales[j]!;
  }
  const ys = Float64Array.from(rows, (r) => (r.accepted ? 1 : 0));
  const weights = new Float64Array(width);
  const grad = new Float64Array(width);
  let bias = 0;
  const m = Math.max(1, n);
  for (let step = 0; step < iterations; step++) {
    grad.fill(0);
    let gradBias = 0;
    for (let i = 0; i < n; i++) {
      const at = i * width;
      let z = bias;
      for (let j = 0; j < width; j++) z += xs[at + j]! * weights[j]!;
      const error = sigmoid(z) - ys[i]!;
      gradBias += error;
      for (let j = 0; j < width; j++) grad[j]! += error * xs[at + j]!;
    }
    for (let j = 0; j < width; j++) weights[j]! -= learningRate * (grad[j]! / m + l2 * weights[j]!);
    bias -= learningRate * (gradBias / m);
  }
  return { version: MODEL_VERSION, means, scales, weights: Array.from(weights), bias, unknownRate, offers: n };
}

/**
 * The chance the agent takes this offer, by the model; none from a model kept for other inputs, or one gone wrong,
 * so ranking goes on as without it.
 */
export function predictAcceptance(model: AcceptanceModel, features: OfferFeatures): number | null {
  if (
    model.version !== MODEL_VERSION ||
    model.means?.length !== WIDTH ||
    model.scales?.length !== WIDTH ||
    model.weights?.length !== WIDTH
  ) {
    return null;
  }
  const x = inputs(features, Number.isFinite(model.unknownRate) ? model.unknownRate : 0.5);
  let z = model.bias;
  for (let j = 0; j < WIDTH; j++) z += ((x[j]! - model.means[j]!) / model.scales[j]!) * model.weights[j]!;
  return Number.isFinite(z) ? sigmoid(z) : null;
}

/** How well the model explains these answers: lower is better; always guessing the share taken is the bar. */
export function logLoss(model: AcceptanceModel, rows: Array<{ features: OfferFeatures; accepted: boolean }>): number {
  if (!rows.length) return 0;
  const eps = 1e-9;
  return (
    -rows.reduce((s, r) => {
      const p = Math.min(1 - eps, Math.max(eps, predictAcceptance(model, r.features) ?? 0.5));
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
