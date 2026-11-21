import { describe, expect, it } from 'vitest';
import { boardCell, boardCellsAround, byBestForYou, perKmKobo } from '../src/board';

/** The open board (docs/matching.md, M11). */
describe('the board', () => {
  const at = (minutes: number) => new Date(Date.UTC(2026, 10, 21, 10, minutes)).toISOString();

  it('orders best for you: quickest to reach by the minute, then most per km, then newest', () => {
    const errands = [
      { id: 'far', travelSeconds: 400, perKmKobo: 90_000, createdAt: at(1) },
      { id: 'near-low', travelSeconds: 130, perKmKobo: 20_000, createdAt: at(3) },
      { id: 'near-high', travelSeconds: 150, perKmKobo: 50_000, createdAt: at(1) },
      { id: 'near-high-newer', travelSeconds: 170, perKmKobo: 50_000, createdAt: at(2) },
    ];
    expect([...errands].sort(byBestForYou).map((e) => e.id)).toEqual([
      'near-high-newer',
      'near-high',
      'near-low',
      'far',
    ]);
  });

  it('works out what the agent earns per km of the whole trip, there and along the errand', () => {
    expect(perKmKobo(200_000, 1_500, 2_500)).toBe(50_000);
    // A trip shorter than a km counts as one.
    expect(perKmKobo(100_000, 200, 300)).toBe(100_000);
  });

  it('names the area cells an agent watches, enough to cover their reach', () => {
    expect(boardCell({ lat: 6.581, lng: 3.355 })).toBe('65:33');
    const around = boardCellsAround({ lat: 6.581, lng: 3.355 }, 10);
    expect(around).toHaveLength(9);
    expect(around).toContain('65:33');
    expect(around).toContain('64:32');
    expect(around).toContain('66:34');
    // A farther reach takes more rings of cells.
    expect(boardCellsAround({ lat: 6.581, lng: 3.355 }, 25)).toHaveLength(49);
    // A pickup within reach is in a watched cell.
    expect(around).toContain(boardCell({ lat: 6.581 + 0.09, lng: 3.355 - 0.09 }));
  });
});
