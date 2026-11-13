/** The session token and the sign-in challenge live in httpOnly cookies the browser's scripts can't read. */
export const SESSION_COOKIE = 'jiffo_admin';
export const CHALLENGE_COOKIE = 'jiffo_admin_challenge';
export const COUNTRY_COOKIE = 'jiffo_admin_country';

export const secureCookie = (maxAgeSeconds: number) => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  path: '/',
  maxAge: maxAgeSeconds,
});
