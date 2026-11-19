import type { NextFunction, Request, Response } from 'express';

/** The API answers JSON: nothing in it may load, run or be framed. */
export const API_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

/** The API's own small HTML pages (identity done, security): text and inline styles, no scripts. */
export const PAGE_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

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
