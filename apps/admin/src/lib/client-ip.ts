/**
 * The admin's IP address from X-Forwarded-For. Each load balancer adds the address it saw at the right-hand
 * end, so the client is `hops` entries from the right; anything further left was written by the client and
 * can't be trusted. With no load balancer, Next.js fills the header with the connection's own address.
 */
export function clientIp(forwardedFor: string | null, hops: number): string | null {
  const entries = (forwardedFor ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return entries[entries.length - Math.max(hops, 1)] ?? null;
}
