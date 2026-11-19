import { networkType } from '../../modules/app-attest';

/**
 * The connection kind each request carries (`x-jiffo-network`; docs/security-plan.md, E6), read from the
 * phone for each request, so a phone that has just left Wi-Fi doesn't send its phone network's address as
 * Wi-Fi. The server keeps a keyed hash of the address for Wi-Fi and wired connections, and marks a phone
 * network's address as a carrier's, so a customer and agent sharing a home network can be flagged for staff.
 */
export async function networkHeaders(): Promise<Record<string, string>> {
  const type = await networkType();
  return type && type !== 'none' ? { 'x-jiffo-network': type } : {};
}
