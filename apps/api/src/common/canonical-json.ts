/**
 * JSON with every object's keys in order, so the same data always gives the same text, and so the same hash
 * however it was stored or sent: Postgres's jsonb, for one, keeps keys in an order of its own. A value with
 * its own JSON form (a Date's ISO text) is written as JSON.stringify writes it.
 */
export function canonicalJson(value: unknown): string {
  if (value !== null && typeof value === 'object' && typeof (value as { toJSON?: unknown }).toJSON === 'function') {
    return canonicalJson((value as { toJSON: () => unknown }).toJSON());
  }
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}
