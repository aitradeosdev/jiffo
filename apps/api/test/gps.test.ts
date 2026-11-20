import { describe, expect, it } from 'vitest';
import { impossibleMove, staysPut, straightRun, type TrailPoint } from '../src/risk/gps';

/** The server's fake-GPS checks (docs/security-plan.md, G1, E6), on positions alone. */
describe('GPS checks', () => {
  const at = (seconds: number) => new Date(Date.UTC(2026, 10, 1, 12, 0, seconds));
  const limits = { maxSpeedKmh: 150, jumpMeters: 1000 };
  // About 111 m per 0.001 degree of latitude.
  const north = (metres: number) => metres / 111_195;

  describe('impossible moves', () => {
    it('finds a jump across the city in seconds', () => {
      const move = impossibleMove(
        { lat: 6.45, lng: 3.47, at: at(0) },
        { lat: 6.45 + north(20_000), lng: 3.47, at: at(10) },
        limits,
      );
      expect(move).toMatchObject({ metres: expect.closeTo(20_000, -2), seconds: 10 });
      expect(move!.kmh).toBeGreaterThan(5_000);
    });

    it('leaves GPS noise, a fast drive and a long gap alone', () => {
      const from = { lat: 6.45, lng: 3.47, at: at(0) };
      // 500 m in 10 seconds: too fast, but within what a phone's GPS jumps by.
      expect(impossibleMove(from, { lat: 6.45 + north(500), lng: 3.47, at: at(10) }, limits)).toBeNull();
      // 5 km in 10 minutes: 30 km/h.
      expect(impossibleMove(from, { lat: 6.45 + north(5_000), lng: 3.47, at: at(600) }, limits)).toBeNull();
      // A coarse fix (a cell tower's, off by a kilometre or more) and then a GPS one: the move is no more
      // than the two fixes' doubt.
      expect(
        impossibleMove(
          { ...from, accuracy: 1_400 },
          { lat: 6.45 + north(1_300), lng: 3.47, at: at(10), accuracy: 8 },
          limits,
        ),
      ).toBeNull();
      // The same moment twice.
      expect(impossibleMove(from, { lat: 6.45 + north(5_000), lng: 3.47, at: at(0) }, limits)).toBeNull();
    });
  });

  describe('staying put', () => {
    const still = (n: number, every = 60, spread = 20): TrailPoint[] =>
      Array.from({ length: n }, (_, i) => ({
        lat: 6.43 + north((i % 3) * (spread / 2)),
        lng: 3.41,
        at: at(i * every),
      }));

    it('finds an agent who never left one spot for minutes', () => {
      expect(staysPut(still(6), { metres: 150, minPoints: 3, minMinutes: 5, maxGapMinutes: 3 })).toMatchObject({
        points: 6,
      });
    });

    it("can't tell when positions stopped coming for a while: the agent may have travelled meanwhile", () => {
      const gap = [0, 60, 120, 600, 660, 720].map((s) => ({ lat: 6.43, lng: 3.41, at: at(s) }));
      expect(staysPut(gap, { metres: 150, minPoints: 3, minMinutes: 5, maxGapMinutes: 3 })).toBeNull();
    });

    it("can't tell from too few points or too short a time, or from a trail that moves", () => {
      expect(staysPut(still(2), { metres: 150, minPoints: 3, minMinutes: 5, maxGapMinutes: 3 })).toBeNull();
      expect(staysPut(still(6, 10), { metres: 150, minPoints: 3, minMinutes: 5, maxGapMinutes: 3 })).toBeNull();
      expect(staysPut(still(6, 60, 400), { metres: 150, minPoints: 3, minMinutes: 5, maxGapMinutes: 3 })).toBeNull();
    });
  });

  describe('straight, even trails', () => {
    const line = (n: number, metresEach: number, jitter: (i: number) => number = () => 0): TrailPoint[] =>
      Array.from({ length: n }, (_, i) => ({
        lat: 6.43 + north(i * metresEach),
        lng: 3.41 + north(jitter(i)),
        at: at(i * 10),
      }));

    it('finds a run along a ruler at an even speed, as a route-faking app makes', () => {
      expect(straightRun(line(10, 80))).toMatchObject({ points: 8 });
    });

    it("leaves a real phone's trail alone: its points wander, and its speed changes", () => {
      const noisy = line(10, 80, (i) => [0, 4, -3, 6, -5, 2, -4, 5, -2, 3][i]!);
      expect(straightRun(noisy)).toBeNull();
      const uneven = Array.from({ length: 10 }, (_, i) => ({
        lat: 6.43 + north([0, 60, 150, 200, 290, 330, 420, 500, 560, 650][i]!),
        lng: 3.41,
        at: at(i * 10),
      }));
      expect(straightRun(uneven)).toBeNull();
      // Too short to say: a few metres in all.
      expect(straightRun(line(10, 5))).toBeNull();
    });
  });
});
