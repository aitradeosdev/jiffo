import { haversineMeters } from '../adapters/maps';

/**
 * The server's fake-GPS checks (docs/security-plan.md, G1, E6), on positions alone: an impossible move, an
 * agent who never left one spot, and the perfectly straight, even runs an app that fakes a route makes. Each
 * gives what it found, for a flag a person looks at, or null.
 */

export interface TrailPoint {
  lat: number;
  lng: number;
  at: Date;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * A move no phone could make between two reports: at least `jumpMeters` (so a phone's GPS wandering a few
 * hundred metres doesn't count), faster than `maxSpeedKmh`.
 */
export function impossibleMove(
  before: TrailPoint,
  after: TrailPoint,
  limits: { maxSpeedKmh: number; jumpMeters: number },
) {
  const seconds = (after.at.getTime() - before.at.getTime()) / 1000;
  if (seconds <= 0) return null;
  const metres = haversineMeters(before, after);
  if (metres < limits.jumpMeters) return null;
  const kmh = metres / 1000 / (seconds / 3600);
  return kmh > limits.maxSpeedKmh
    ? { metres: Math.round(metres), seconds: round1(seconds), kmh: Math.round(kmh) }
    : null;
}

/**
 * The agent stayed within `metres` of where the trail starts, over at least `minPoints` points and
 * `minMinutes`. Fewer points, or less time, can't tell staying put from a trail that wasn't sent.
 */
export function staysPut(points: TrailPoint[], limits: { metres: number; minPoints: number; minMinutes: number }) {
  if (points.length < limits.minPoints) return null;
  const first = points[0]!;
  const minutes = (points[points.length - 1]!.at.getTime() - first.at.getTime()) / 60_000;
  if (minutes < limits.minMinutes) return null;
  const farthest = Math.max(...points.map((p) => haversineMeters(first, p)));
  return farthest < limits.metres
    ? { points: points.length, metres: Math.round(farthest), minutes: round1(minutes) }
    : null;
}

/** How many points in a row make a run worth judging, and how a faked one looks. */
const RUN = 8;
const RUN_MIN_METRES = 300;
/** A phone's GPS wanders a few metres either side of the road; a faked route doesn't. */
const OFF_LINE_METRES = 1.5;
/** A driver's speed changes from one ten seconds to the next; a faked route's doesn't. */
const SPEED_SPREAD = 0.03;
const METRES_PER_DEGREE = 111_195;

/**
 * A run of points along a ruler at an even speed: every point within a metre and a half of the line from
 * its first to its last, over at least 300 m, with each step's speed within 3% of the run's.
 */
export function straightRun(points: TrailPoint[]) {
  for (let i = 0; i + RUN <= points.length; i += 1) {
    const run = points.slice(i, i + RUN);
    const a = run[0]!;
    const b = run[RUN - 1]!;
    const length = haversineMeters(a, b);
    if (length < RUN_MIN_METRES) continue;
    // Metres east and north of the run's start: flat enough over a few kilometres.
    const scale = Math.cos((a.lat * Math.PI) / 180);
    const xy = (p: TrailPoint) => ({
      x: (p.lng - a.lng) * scale * METRES_PER_DEGREE,
      y: (p.lat - a.lat) * METRES_PER_DEGREE,
    });
    const end = xy(b);
    const span = Math.hypot(end.x, end.y);
    const offLine = run.slice(1, -1).map((p) => {
      const q = xy(p);
      return Math.abs(end.x * q.y - end.y * q.x) / span;
    });
    if (Math.max(...offLine) > OFF_LINE_METRES) continue;
    const speeds: number[] = [];
    for (let j = 1; j < run.length; j += 1) {
      const seconds = (run[j]!.at.getTime() - run[j - 1]!.at.getTime()) / 1000;
      if (seconds <= 0) break;
      speeds.push(haversineMeters(run[j - 1]!, run[j]!) / seconds);
    }
    if (speeds.length < RUN - 1) continue;
    const mean = speeds.reduce((sum, s) => sum + s, 0) / speeds.length;
    if (mean <= 0 || speeds.some((s) => Math.abs(s - mean) / mean > SPEED_SPREAD)) continue;
    return { points: RUN, metres: Math.round(length), kmh: Math.round(mean * 3.6) };
  }
  return null;
}
