import { isIP } from 'node:net';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { providerFetch } from '../adapters/provider-fetch';
import { DB, type Db } from '../db/database.module';
import { cloudIpRanges } from '../db/schema';

/** The cloud providers whose published address ranges are kept, and where each publishes them. */
export const CLOUD_PROVIDERS = {
  aws: 'https://ip-ranges.amazonaws.com/ip-ranges.json',
  google: 'https://www.gstatic.com/ipranges/cloud.json',
  // Microsoft publishes Azure's under a new file name each week, linked from this page.
  azure: 'https://www.microsoft.com/en-us/download/details.aspx?id=56519',
  oracle: 'https://docs.oracle.com/en-us/iaas/tools/public_ip_ranges.json',
  digitalocean: 'https://www.digitalocean.com/geo/google.csv',
  linode: 'https://geoip.linode.com/',
  vultr: 'https://geofeed.constant.com/?text',
} as const;
export type CloudProvider = keyof typeof CLOUD_PROVIDERS;

/** No list is bigger than this; one that is, is refused rather than read. */
const MAX_BYTES = 30 * 1024 * 1024;
const AZURE_FILE = /https:\/\/download\.microsoft\.com\/download\/[^"'\s<>]+ServiceTags_Public_\d+\.json/;

/** An address range as the lists write them (1.2.3.0/24, 2600:1f14::/35), or null. */
function rangeOf(text: unknown): string | null {
  if (typeof text !== 'string') return null;
  const [address, bits, extra] = text.trim().split('/');
  if (extra !== undefined || !address || !bits || !/^\d{1,3}$/.test(bits)) return null;
  const family = isIP(address);
  if (!family || Number(bits) > (family === 4 ? 32 : 128)) return null;
  return `${address}/${Number(bits)}`;
}

/** The first column of each line of a CSV geofeed, those that are ranges. */
const csvRanges = (text: string) =>
  text
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => rangeOf(line.split(',')[0]));

/**
 * Cloud providers' published address ranges (docs/security-plan.md, A10), so a sign-in from a server rather
 * than a phone is seen. Fetched daily from each provider's own list: nothing about anyone is sent. A list that
 * can't be read keeps that provider's ranges as they were.
 */
@Injectable()
export class CloudRangesService {
  private readonly logger = new Logger(CloudRangesService.name);

  constructor(@Inject(DB) private readonly db: Db) {}

  /** Every provider's list, one after another; each that fails keeps its ranges, and is logged. */
  async refresh(fetcher: typeof fetch = providerFetch) {
    const kept: Partial<Record<CloudProvider, number>> = {};
    for (const provider of Object.keys(CLOUD_PROVIDERS) as CloudProvider[]) {
      try {
        const ranges = this.parse(provider, await this.download(provider, fetcher));
        kept[provider] = await this.replace(provider, ranges);
      } catch (error) {
        this.logger.warn(`${provider}'s address ranges weren't refreshed: ${(error as Error).message}`);
      }
    }
    return kept;
  }

  /** Whether any provider's ranges are kept yet. */
  async any() {
    const { rows } = await this.db.execute(sql`select 1 from ${cloudIpRanges} limit 1`);
    return rows.length > 0;
  }

  /** The ranges in one provider's list, as it publishes it. Anything that isn't a range is left out. */
  parse(provider: CloudProvider, text: string): string[] {
    const ranges: unknown[] = [];
    if (provider === 'digitalocean' || provider === 'linode' || provider === 'vultr') {
      ranges.push(...csvRanges(text));
    } else {
      const doc = JSON.parse(text) as Record<string, unknown>;
      const list = (key: string) => (Array.isArray(doc[key]) ? (doc[key] as Array<Record<string, unknown>>) : []);
      if (provider === 'aws') {
        ranges.push(...list('prefixes').map((p) => p.ip_prefix), ...list('ipv6_prefixes').map((p) => p.ipv6_prefix));
      } else if (provider === 'google') {
        ranges.push(...list('prefixes').map((p) => p.ipv4Prefix ?? p.ipv6Prefix));
      } else if (provider === 'azure') {
        for (const v of list('values')) {
          const prefixes = (v.properties as { addressPrefixes?: unknown } | undefined)?.addressPrefixes;
          if (Array.isArray(prefixes)) ranges.push(...prefixes);
        }
      } else if (provider === 'oracle') {
        for (const region of list('regions')) {
          const cidrs = Array.isArray(region.cidrs) ? (region.cidrs as Array<{ cidr?: unknown }>) : [];
          ranges.push(...cidrs.map((c) => c.cidr));
        }
      }
    }
    return [...new Set(ranges.map(rangeOf).filter((r): r is string => !!r))];
  }

  /** One provider's ranges, all at once. An empty list (one that came back broken) changes nothing. */
  async replace(provider: CloudProvider, ranges: string[]) {
    if (!ranges.length) return 0;
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`delete from ${cloudIpRanges} where provider = ${provider}`);
      // One array, as Postgres writes them: each range was checked to be digits, dots, colons and a slash only.
      // network() clears any host bits a list leaves in, so each is a range Postgres takes.
      const list = `{${ranges.join(',')}}`;
      await tx.execute(sql`
        insert into ${cloudIpRanges} (provider, range)
        select ${provider}, network(r::inet)::cidr from unnest(${list}::text[]) as r
        on conflict do nothing`);
    });
    return ranges.length;
  }

  /**
   * The provider whose published ranges the address is in, or null. An IPv4 address written the IPv6 way
   * (::ffff:1.2.3.4, as a server listening on both sees one) is read as the IPv4 address it is.
   */
  async providerOf(ip: string | null | undefined, db: Db = this.db): Promise<string | null> {
    const address = ip?.toLowerCase().startsWith('::ffff:') && isIP(ip.slice(7)) === 4 ? ip.slice(7) : ip;
    // Only plain addresses: one with a zone (fe80::1%eth0) is a local link, and Postgres wouldn't read it.
    if (!address || address.includes('%') || !isIP(address)) return null;
    const { rows } = await db.execute<{ provider: string }>(
      sql`select provider from ${cloudIpRanges} where range >>= ${address}::inet limit 1`,
    );
    return rows[0]?.provider ?? null;
  }

  private async download(provider: CloudProvider, fetcher: typeof fetch) {
    let url: string = CLOUD_PROVIDERS[provider];
    if (provider === 'azure') {
      const page = await this.read(url, fetcher);
      const file = AZURE_FILE.exec(page)?.[0];
      if (!file) throw new Error("the download page didn't link this week's file");
      url = file;
    }
    return this.read(url, fetcher);
  }

  /** A list's text, read a piece at a time: one past the limit is stopped there, not read whole first. */
  private async read(url: string, fetcher: typeof fetch) {
    const res = await fetcher(url, { headers: { accept: 'application/json, text/csv, text/plain, */*' } });
    if (!res.ok) throw new Error(`${url} answered ${res.status}`);
    const length = Number(res.headers.get('content-length') ?? 0);
    if (length > MAX_BYTES) {
      await res.body?.cancel();
      throw new Error(`${url} is too big (${length} bytes)`);
    }
    if (!res.body) return '';
    const reader = res.body.getReader();
    const pieces: Uint8Array[] = [];
    let bytes = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BYTES) {
        await reader.cancel();
        throw new Error(`${url} is too big (over ${MAX_BYTES} bytes)`);
      }
      pieces.push(value);
    }
    return Buffer.concat(pieces).toString('utf8');
  }
}
