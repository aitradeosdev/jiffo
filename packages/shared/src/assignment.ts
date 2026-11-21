/**
 * Agents for several urgent errands at once (docs/matching.md, M5): `weights[i][j]` is how well agent j suits
 * errand i (their score for it), or null where they may not take it. Returns, for each errand, its agent's column,
 * or null for none, each agent at most once: as many errands as can get an agent, and among those ways, the
 * highest total score. The Hungarian method (Kuhn–Munkres), O(n³) in errands plus agents.
 */
export function bestAssignment(weights: (number | null)[][]): (number | null)[] {
  const rows = weights.length;
  const cols = rows ? Math.max(...weights.map((r) => r.length)) : 0;
  if (!rows || !cols) return weights.map(() => null);
  // Every pair made is worth more than any difference in score, so the most errands are served first.
  const top = Math.max(0, ...weights.flat().map((w) => (w === null ? 0 : Math.abs(w))));
  const perPair = top * Math.min(rows, cols) * 2 + 1;
  // Square: each errand may also take an "agent" that is none, and each agent an "errand" that is none.
  const n = rows + cols;
  const NONE = perPair + top + 1;
  const FORBIDDEN = NONE * (n + 1);
  const cost = (i: number, j: number) => {
    if (i >= rows || j >= cols) return NONE;
    const w = weights[i]![j];
    return w === null || w === undefined ? FORBIDDEN : NONE - perPair - w;
  };
  // Potentials and the matching, 1-based as the method is usually written: p[j] is the row holding column j.
  const u = new Array<number>(n + 1).fill(0);
  const v = new Array<number>(n + 1).fill(0);
  const p = new Array<number>(n + 1).fill(0);
  const way = new Array<number>(n + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array<number>(n + 1).fill(Infinity);
    const used = new Array<boolean>(n + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0]!;
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= n; j++) {
        if (used[j]) continue;
        const cur = cost(i0 - 1, j - 1) - u[i0]! - v[j]!;
        if (cur < minv[j]!) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j]! < delta) {
          delta = minv[j]!;
          j1 = j;
        }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) {
          u[p[j]!] = u[p[j]!]! + delta;
          v[j] = v[j]! - delta;
        } else {
          minv[j] = minv[j]! - delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0]!;
      p[j0] = p[j1]!;
      j0 = j1;
    } while (j0);
  }
  const picked = new Array<number | null>(rows).fill(null);
  for (let j = 1; j <= cols; j++) {
    const i = p[j]! - 1;
    if (i < rows && weights[i]![j - 1] !== null && weights[i]![j - 1] !== undefined) picked[i] = j - 1;
  }
  return picked;
}
