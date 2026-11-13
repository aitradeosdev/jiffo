import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE } from './lib/cookies';

/**
 * Sends anyone without a session cookie to sign in before a panel page starts rendering. This is only the
 * quick check: the API decides on every request whether the session is still good.
 */
export function proxy(request: NextRequest) {
  if (request.cookies.has(SESSION_COOKIE)) return NextResponse.next();
  return NextResponse.redirect(new URL('/sign-in', request.url));
}

export const config = {
  // Everything except sign-in, invites, Next's own files and the icon.
  matcher: ['/((?!sign-in|invite|_next/|icon\\.png|favicon\\.ico).*)'],
};
