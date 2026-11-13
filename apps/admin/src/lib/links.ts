/** A list page's link with some query values changed (null removes one, and defaults are left out). */
export function listLink(
  base: string,
  current: Record<string, string | undefined>,
  changes: Record<string, string | null>,
  defaults: Record<string, string> = {},
) {
  const next = new URLSearchParams();
  for (const [k, v] of Object.entries(current)) if (v) next.set(k, v);
  for (const [k, v] of Object.entries(changes)) {
    if (v === null) next.delete(k);
    else next.set(k, v);
  }
  for (const [k, v] of Object.entries(defaults)) if (next.get(k) === v) next.delete(k);
  const s = next.toString();
  return s ? `${base}?${s}` : base;
}
