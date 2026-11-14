import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE } from './lib/cookies';

/** Pages anyone may open without a session: sign-in and invites. */
const OPEN = /^\/(sign-in|invite)(\/|$)/;

/**
 * A content security policy for every page of the panel (docs/security-plan.md, S3, R7): only scripts carrying
 * this response's nonce run (Next.js adds it to its own), plus what they load ('strict-dynamic'), so a script
 * injected into a page can't. Pages can't be framed, and forms post only back to the panel.
 */
export function contentPolicy(nonce: string, dev = process.env.NODE_ENV !== 'production') {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    // Photos come from the API's storage; the sign-in QR code is a data URL.
    `img-src 'self' data: blob: https:${dev ? ' http:' : ''}`,
    "font-src 'self' data:",
    `connect-src 'self'${dev ? ' ws: http:' : ''}`,
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
  const csp = contentPolicy(nonce);
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
