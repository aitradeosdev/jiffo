import type { IncomingHttpHeaders } from 'node:http';

/** The origins CORS_ORIGINS allows: any (`*`, development only) or the listed ones. */
export function allowedOrigins(list: string): true | string[] {
  return list.trim() === '*'
    ? true
    : list
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean);
}

/**
 * Whether a live connection may open from where it says it comes from. Browsers send the page's origin and
 * it must be one CORS_ORIGINS lists: a WebSocket upgrade gets no CORS check of its own, so this is the only
 * one. The phone apps send the API's own address, or nothing, as other non-browser clients do.
 */
export function originAllowed(headers: IncomingHttpHeaders, list: string): boolean {
  const origin = headers.origin;
  const allowed = allowedOrigins(list);
  if (!origin || allowed === true || allowed.includes(origin)) return true;
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    return false;
  }
  const forwarded = headers['x-forwarded-host'];
  const own = [headers.host, ...(Array.isArray(forwarded) ? forwarded : (forwarded?.split(',') ?? []))];
  return own.some((h) => !!h && h.trim() === host);
}
