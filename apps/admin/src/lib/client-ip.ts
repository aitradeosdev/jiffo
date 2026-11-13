/**
 * The admin's IP address from X-Forwarded-For. Each load balancer adds the address it saw at the right-hand
 * end, so the client is `hops` entries from the right; anything further left was written by the client and
 * can't be trusted. With no load balancer (local development only), Next.js fills the header with the
 * connection's address when the request has none, but keeps one the client sent, which is why production
 * needs TRUST_PROXY_HOPS of at least 1.
 */
export function clientIp(forwardedFor: string | null, hops: number): string | null {
  const entries = (forwardedFor ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return entries[entries.length - Math.max(hops, 1)] ?? null;
}
