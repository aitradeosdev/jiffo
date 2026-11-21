/**
 * Agents for several urgent errands at once (docs/matching.md, M5): `weights[i][j]` is how well agent j suits
 * errand i (their score for it), or null where they may not take it; a score that isn't a finite number counts as
 * null. Returns, for each errand, its agent's column, or null for none, each agent at most once: as many errands as
 * can get an agent, and among those ways, the highest total score. The Hungarian method (Kuhn–Munkres) for more
 * columns than rows, O(errands² × (agents + errands)).
 */
export function bestAssignment(weights: (number | null)[][]): (number | null)[] {
  const rows = weights.length;
  const cols = rows ? Math.max(...weights.map((r) => r.length)) : 0;
  if (!rows || !cols) return weights.map(() => null);
  const allowed = (i: number, j: number) => {
    const w = weights[i]![j];
    return typeof w === 'number' && Number.isFinite(w) ? w : null;
  };
  let top = 0;
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const w = allowed(i, j);
      if (w !== null && Math.abs(w) > top) top = Math.abs(w);
    }
  }
  // Every pair made is worth more than any difference in score, so the most errands are served first.
  const perPair = top * Math.min(rows, cols) * 2 + 1;
  // Each errand may also take one of `rows` "agents" that are none, costing as much as not being served.
  const m = cols + rows;
  const NONE = perPair + top + 1;
  const FORBIDDEN = NONE * (rows + 1) * 4;
  const cost = (i: number, j: number) => {
    if (j >= cols) return NONE;
    const w = allowed(i, j);
    return w === null ? FORBIDDEN : NONE - perPair - w;
  };
  // Potentials and the matching, 1-based as the method is usually written: p[j] is the row holding column j.
  const u = new Array<number>(rows + 1).fill(0);
  const v = new Array<number>(m + 1).fill(0);
  const p = new Array<number>(m + 1).fill(0);
  const way = new Array<number>(m + 1).fill(0);
  const minv = new Array<number>(m + 1);
  const used = new Array<boolean>(m + 1);
  for (let i = 1; i <= rows; i++) {
    p[0] = i;
    let j0 = 0;
    minv.fill(Infinity);
    used.fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0]!;
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= m; j++) {
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
      // Every cost is finite and there are more columns than rows, so a column is always found.
      if (j1 === 0) throw new Error('bestAssignment found no column to extend the matching');
      for (let j = 0; j <= m; j++) {
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
    if (i >= 0 && allowed(i, j - 1) !== null) picked[i] = j - 1;
  }
  return picked;
}
