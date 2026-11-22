import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE } from './lib/cookies';

/** Pages anyone may open without a session: sign-in and invites. */
const OPEN = /^\/(sign-in|invite)(\/|$)/;
/** The one page that loads a map: Settings, Places, where cities and areas are drawn. */
const MAP_PAGE = /^\/settings\/places(\/|$)/;

/**
 * A content security policy for every page of the panel (docs/security-plan.md, S3, R7): only scripts carrying
 * this response's nonce run (Next.js adds it to its own), plus what they load ('strict-dynamic'), so a script
 * injected into a page can't. Pages can't be framed, and forms post only back to the panel.
 */
export function contentPolicy(
  nonce: string,
  dev = process.env.NODE_ENV !== 'production',
  { maps = false }: { maps?: boolean } = {},
) {
  // The map, on the one page that draws it: Google's or Mapbox's, whichever is the maps provider in use (its
  // terms keep its places on its own map). Their data, tiles and fonts, and the workers both start from blob URLs
  // (worker-src). Google's scripts load through the panel's own ('strict-dynamic'), so no host is added for them
  // (Google's guide to strict policies); Mapbox's are bundled with the panel. Mapbox's hosts are as its guide to
  // content security policies lists them.
  const map = maps
    ? {
        style: ' https://fonts.googleapis.com',
        font: ' https://fonts.gstatic.com',
        connect:
          ' https://*.googleapis.com https://*.gstatic.com https://api.mapbox.com https://*.tiles.mapbox.com https://events.mapbox.com data: blob:',
      }
    : { style: '', font: '', connect: '' };
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    `style-src 'self' 'unsafe-inline'${map.style}`,
    // Photos come from the API's storage; the sign-in QR code is a data URL; the map's tiles are https.
    `img-src 'self' data: blob: https:${dev ? ' http:' : ''}`,
    `font-src 'self' data:${map.font}`,
    `connect-src 'self'${dev ? ' ws: http:' : ''}${map.connect}`,
    ...(maps ? ['worker-src blob:'] : []),
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/**
 * Sends anyone without a session cookie to sign in before a panel page starts rendering. This is only the
 * quick check: the API decides on every request whether the session is still good. Every page gets the
 * content policy, with a fresh nonce.
 */
export function proxy(request: NextRequest) {
  if (!OPEN.test(request.nextUrl.pathname) && !request.cookies.has(SESSION_COOKIE)) {
    return NextResponse.redirect(new URL('/sign-in', request.url));
  }
  const nonce = btoa(crypto.randomUUID());
  const csp = contentPolicy(nonce, undefined, { maps: MAP_PAGE.test(request.nextUrl.pathname) });
  // Next.js reads the nonce from the request's policy and puts it on every script it adds to the page.
  const headers = new Headers(request.headers);
  headers.set('content-security-policy', csp);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set('content-security-policy', csp);
  return response;
}

export const config = {
  // Everything except Next's own files and the icons.
  matcher: ['/((?!_next/|icon\\.png|favicon\\.ico).*)'],
};
