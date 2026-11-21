import { describe, expect, it } from 'vitest';
import { sortBoard, watchAgain } from './board-order';

const job = (id: string, o: Partial<{ distanceMeters: number; feeKobo: number; createdAt: string; buy: boolean }>) => ({
  id,
  distanceMeters: 1_000,
  feeKobo: 200_000,
  createdAt: '2026-11-21T10:00:00.000Z',
  buy: false,
  ...o,
});

/** The board's orders (docs/matching.md, M11): best for you as the server sends it, or the agent's choice. */
describe('the board order', () => {
  const list = [
    job('a', { distanceMeters: 2_000, feeKobo: 300_000, createdAt: '2026-11-21T10:01:00.000Z' }),
    job('b', { distanceMeters: 500, feeKobo: 100_000, createdAt: '2026-11-21T10:03:00.000Z', buy: true }),
    job('c', { distanceMeters: 1_000, feeKobo: 200_000, createdAt: '2026-11-21T10:02:00.000Z' }),
  ];

  it('keeps best for you as it came, and sorts by nearest, the fee shown, or newest', () => {
    expect(sortBoard(list, 'best').map((j) => j.id)).toEqual(['a', 'b', 'c']);
    expect(sortBoard(list, 'near').map((j) => j.id)).toEqual(['b', 'c', 'a']);
    expect(sortBoard(list, 'fee').map((j) => j.id)).toEqual(['a', 'c', 'b']);
    expect(sortBoard(list, 'newest').map((j) => j.id)).toEqual(['b', 'c', 'a']);
    expect(sortBoard(list, 'buy').map((j) => j.id)).toEqual(['b']);
  });

  it('watches the board again after moving a km, or every five minutes', () => {
    const at = { lat: 6.58, lng: 3.355 };
    const last = { at, when: 0 };
    expect(watchAgain(null, at, 0)).toBe(true);
    expect(watchAgain(last, { lat: 6.584, lng: 3.355 }, 60_000)).toBe(false);
    expect(watchAgain(last, { lat: 6.59, lng: 3.355 }, 60_000)).toBe(true);
    expect(watchAgain(last, at, 5 * 60_000)).toBe(true);
  });
});
