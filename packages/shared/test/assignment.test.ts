import { describe, expect, it } from 'vitest';
import { bestAssignment } from '../src/assignment';

const total = (weights: (number | null)[][], picked: (number | null)[]) =>
  picked.reduce<number>((sum, j, i) => sum + (j === null ? 0 : weights[i]![j]!), 0);

/**
 * Several urgent errands at once (docs/matching.md, M5): agents assigned so as many errands as possible get one,
 * and among those ways, the total score is highest.
 */
describe('the best assignment', () => {
  it('beats giving each errand its best agent in turn', () => {
    // One agent is best for both errands; the other can reach only the first.
    const weights = [
      [0.9, 0.8],
      [0.85, null],
    ];
    // In turn, the first takes agent 0 and the second gets no one: 0.9.
    expect(bestAssignment(weights)).toEqual([1, 0]);
    expect(total(weights, bestAssignment(weights))).toBeCloseTo(1.65);
  });

  it('gives each agent at most one errand, and leaves errands over when agents run out', () => {
    const picked = bestAssignment([[0.5], [0.9], [0.7]]);
    expect(picked.filter((j) => j !== null)).toEqual([0]);
    expect(picked).toEqual([null, 0, null]);
    expect(bestAssignment([[0.2, 0.6, 0.4]])).toEqual([1]);
  });

  it('never makes a pair that may not be, and copes with none at all', () => {
    expect(bestAssignment([[null], [null]])).toEqual([null, null]);
    expect(bestAssignment([])).toEqual([]);
    expect(bestAssignment([[null, 0.3]])).toEqual([1]);
  });

  it('finds the best total where taking the biggest score first does not', () => {
    const weights = [
      [10, 9, 1],
      [9, 1, 1],
      [8, 1, 1],
    ];
    // Biggest first: 10 + 1 + 1 = 12. Best: 9 + 9 + 1 = 19.
    const picked = bestAssignment(weights);
    expect(total(weights, picked)).toBe(19);
    expect(new Set(picked).size).toBe(3);
  });

  it('serves as many errands as it can before looking at the total, so none is left waiting for want of it', () => {
    // One errand alone scores 0.6; both together 0.55. Both get an agent.
    const weights = [
      [0.6, 0.05],
      [0.5, null],
    ];
    expect(bestAssignment(weights)).toEqual([1, 0]);
  });

  it('treats a score that is not a number as a pair that may not be, rather than never finishing', () => {
    expect(bestAssignment([[Number.NaN, 0.5]])).toEqual([1]);
    expect(bestAssignment([[Number.POSITIVE_INFINITY], [0.3]])).toEqual([null, 0]);
  });

  it('assigns a large batch quickly', () => {
    // 50 errands, each with 25 agents of its own nearby, plus a few shared.
    let seed = 7;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const cols = 50 * 25;
    const weights = Array.from({ length: 50 }, (_, i) =>
      Array.from({ length: cols }, (_, j) => (Math.floor(j / 25) === i || j < 10 ? random() : null)),
    );
    const started = Date.now();
    const picked = bestAssignment(weights);
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(picked.every((j) => j !== null)).toBe(true);
    expect(new Set(picked).size).toBe(50);
  });
});
