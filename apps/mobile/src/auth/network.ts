import { networkType } from '../../modules/app-attest';

const READ_EVERY_MS = 30_000;
let last: { at: number; type: string | null } | null = null;

/**
 * The connection kind each request carries (`x-jiffo-network`; docs/security-plan.md, E6), read from the
 * phone at most every 30 seconds. The server keeps a keyed hash of the address only for Wi-Fi and wired
 * connections, so a customer and agent sharing a home network can be flagged for staff.
 */
export async function networkHeaders(now = Date.now()): Promise<Record<string, string>> {
  if (!last || now - last.at > READ_EVERY_MS) last = { at: now, type: await networkType() };
  return last.type ? { 'x-jiffo-network': last.type } : {};
}
