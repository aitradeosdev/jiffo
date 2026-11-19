/**
 * Links into the app and the parameters screens read (docs/security-plan.md, MB5). Plain TypeScript, so it
 * runs in tests without React Native.
 */

/**
 * The only screens another app or a web page may open: the app's start, and the identity check's way back
 * from the provider's page (the API's identity/done page links there). Nothing else is reached from outside,
 * and no link carries parameters into the app.
 */
const FROM_OUTSIDE = new Set(['/', '/identity-done']);

/** Where a link from outside opens the app: an allowed screen, or else the start. */
export function safeLinkPath(link: string): string {
  try {
    const scheme = /^(jiffo|jiffo-agent):\/\//.exec(link);
    // Only the apps' own schemes, or a bare path; anything else (https, javascript:) opens the start.
    if (!scheme && !link.startsWith('/')) return '/';
    const rest = scheme ? link.slice(scheme[0].length) : link;
    const path = decodeURIComponent(rest.split(/[?#]/)[0] ?? '');
    const clean = `/${path}`.replace(/\/{2,}/g, '/').replace(/(.)\/$/, '$1');
    return FROM_OUTSIDE.has(clean) ? clean : '/';
  } catch {
    return '/';
  }
}

/** A parameter read as one of the values it may have, else `fallback`. */
export function oneOf<T extends string>(value: string | string[] | undefined, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** A parameter read as a whole number from 0 to `max`, else null. */
export function wholeNumber(value: string | string[] | undefined, { max }: { max: number }): number | null {
  if (typeof value !== 'string' || !/^\d{1,15}$/.test(value)) return null;
  const n = Number(value);
  return n <= max ? n : null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** An errand's id from the screen's address, else null: it goes into API paths. */
export const errandIdParam = (value: string | string[] | undefined): string | null =>
  typeof value === 'string' && UUID.test(value) ? value : null;
