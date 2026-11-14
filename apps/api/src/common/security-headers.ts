import { randomBytes } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

/** The API answers JSON: nothing in it may load, run or be framed. */
export const API_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

/** The API's own small HTML pages (finished, expired, try again): text and inline styles, no scripts. */
export const PAGE_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

/**
 * A provider's identity widget page: only scripts with this response's nonce run, and what they load
 * ('strict-dynamic'), so a script injected into the page can't. The widgets reach their own servers and use
 * the camera, so connections, frames and media stay open to https.
 */
export const widgetCsp = (nonce: string) =>
  [
    "default-src 'none'",
    `script-src 'nonce-${nonce}' 'strict-dynamic' https:`,
    "connect-src 'self' https: wss:",
    'frame-src https:',
    "img-src 'self' https: data: blob:",
    "media-src 'self' blob: mediastream:",
    "style-src 'unsafe-inline' https:",
    'font-src https: data:',
    'worker-src blob: https:',
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
  ].join('; ');

/** A widget page with its scripts tagged with a fresh nonce, and the policy that lets only those run. */
export function withNonce(html: string) {
  const nonce = randomBytes(16).toString('base64');
  return { html: html.replace(/<script\b/g, `<script nonce="${nonce}"`), csp: widgetCsp(nonce) };
}

/**
 * Headers on every answer (docs/security-plan.md, S3, finding 20): no sniffing of types, no framing, no
 * referrer, and the strict policy above unless a route sets its own. HTTPS is insisted on in production.
 */
export function securityHeaders(production: boolean) {
  return (_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('x-frame-options', 'DENY');
    res.setHeader('referrer-policy', 'no-referrer');
    res.setHeader('cross-origin-opener-policy', 'same-origin');
    res.setHeader('content-security-policy', API_CSP);
    if (production) res.setHeader('strict-transport-security', 'max-age=31536000; includeSubDomains');
    next();
  };
}
