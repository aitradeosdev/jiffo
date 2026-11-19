import { isIP } from 'node:net';
import { Inject, Injectable, Logger, type BeforeApplicationShutdown } from '@nestjs/common';
import { lt, sql } from 'drizzle-orm';
import { hmacSha256 } from '../common/crypto';
import { keyFor, subKey } from '../common/keys';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { DB, type Db } from '../db/database.module';
import { userNetworks } from '../db/schema';

/** The connection the app says a request came over (`x-jiffo-network`). */
export const NETWORK_HEADER = 'x-jiffo-network';

/** How often one account's use of one network is written down: the last-seen time needs no more. */
const WRITE_EVERY_MS = 15 * 60_000;
/** Two uses of one address count as together when their spans come within a day of each other. */
const TOGETHER_WITHIN = sql`interval '1 day'`;
/** Networks are forgotten this long after last use (docs/security-plan.md, E6, G4). */
export const NETWORK_KEEP_DAYS = 90;
const SHUTDOWN_WAIT_MS = 5_000;

/**
 * What the app said the connection was, as kept: Wi-Fi, wired, or a phone network. A phone network's address
 * is shared by thousands, so it is kept only to mark the address as a carrier's: a MiFi or a phone's hotspot
 * looks like Wi-Fi to the phones on it, but comes out at that same address. A VPN's or an unknown
 * connection's address says nothing, and isn't kept.
 */
const kindOf = (network: string | undefined) =>
  network === 'wifi'
    ? ('wifi' as const)
    : network === 'ethernet'
      ? ('wired' as const)
      : network === 'cellular'
        ? ('cellular' as const)
        : null;

/**
 * The part of an address that names a network: all of an IPv4 address; the first half of an IPv6 one, as a
 * home network keeps it while each phone's own half changes. Null for what isn't an address. A home whose
 * phones reach us over IPv4 and IPv6 both gives two networks, which aren't matched to each other.
 */
export function networkOf(ip: string): string | null {
  const plain = ip
    .trim()
    .toLowerCase()
    .replace(/^::ffff:(?=\d+\.)/, '');
  const family = isIP(plain);
  if (family === 4) return plain;
  if (family !== 6 || plain.includes('.') || plain.includes('%')) return null;
  const [head = '', tail = ''] = plain.split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups = plain.includes('::') ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right] : left;
  return groups
    .slice(0, 4)
    .map((g) => g.replace(/^0+(?=.)/, ''))
    .join(':');
}

/**
 * The Wi-Fi networks and addresses each account's phones used (docs/security-plan.md, E6): written beside
 * each signed-in request, as keyed hashes, so a customer and agent who share a home network can be flagged.
 */
@Injectable()
export class NetworksService implements BeforeApplicationShutdown {
  private readonly logger = new Logger(NetworksService.name);
  private readonly key: string;
  private readonly written = new Map<string, number>();
  private readonly running = new Set<Promise<unknown>>();

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.key = subKey(keyFor(config, 'idFingerprint'), 'jiffo network fingerprint').toString('hex');
  }

  /** A keyed hash of the network an address is on; the address itself is never kept. Null for no address. */
  fingerprint(ip: string) {
    const network = networkOf(ip);
    return network === null ? null : hmacSha256(this.key, network);
  }

  /**
   * A signed-in request: its network is written down beside it, at most every quarter hour per account. It
   * never fails the request: whatever goes wrong is only logged.
   */
  seen(userId: string, ip: string | undefined, network: string | undefined) {
    try {
      this.write(userId, ip, network);
    } catch (error) {
      this.logger.warn(`Reading a request's network failed: ${(error as Error).message}`);
    }
  }

  private write(userId: string, ip: string | undefined, network: string | undefined) {
    const kind = kindOf(network);
    if (!kind || !ip) return;
    const fingerprint = this.fingerprint(ip);
    if (!fingerprint) return;
    const key = `${userId}:${kind}:${fingerprint}`;
    const now = Date.now();
    if (now - (this.written.get(key) ?? 0) < WRITE_EVERY_MS) return;
    if (this.written.size > 50_000) this.written.clear();
    this.written.set(key, now);
    const run: Promise<unknown> = this.db
      .insert(userNetworks)
      .values({ userId, kind, fingerprint })
      .onConflictDoUpdate({
        target: [userNetworks.userId, userNetworks.kind, userNetworks.fingerprint],
        set: { lastSeenAt: new Date() },
      })
      .catch((error: Error) => {
        // Tried again at the next request, not a quarter hour later.
        this.written.delete(key);
        this.logger.warn(`Writing a network down failed: ${error.message}`);
      })
      .finally(() => this.running.delete(run));
    this.running.add(run);
  }

  /**
   * The Wi-Fi networks and wired addresses two accounts used around the same time, within `days`. Left out:
   * an address anyone reached over a phone network in that time (a carrier's, as a MiFi's is), and a busy
   * one (more than `busy` accounts used it: a shop's or an office's Wi-Fi). Each as Wi-Fi when both were on
   * Wi-Fi, else as an address.
   */
  async sharedBetween(a: string, b: string, days: number, busy: number): Promise<Array<'wifi' | 'address'>> {
    const since = sql`now() - make_interval(days => ${days})`;
    const { rows } = await this.db.execute<{ wifi: boolean }>(sql`
      select bool_and(x.kind = 'wifi' and y.kind = 'wifi') as wifi
      from ${userNetworks} x join ${userNetworks} y on y.fingerprint = x.fingerprint
      where x.user_id = ${a} and y.user_id = ${b}
        and x.kind <> 'cellular' and y.kind <> 'cellular'
        and x.last_seen_at > ${since} and y.last_seen_at > ${since}
        and x.first_seen_at <= y.last_seen_at + ${TOGETHER_WITHIN}
        and y.first_seen_at <= x.last_seen_at + ${TOGETHER_WITHIN}
        and not exists (select 1 from ${userNetworks} c
             where c.fingerprint = x.fingerprint and c.kind = 'cellular' and c.last_seen_at > ${since})
        and (select count(distinct z.user_id) from ${userNetworks} z
             where z.fingerprint = x.fingerprint and z.last_seen_at > ${since}) <= ${busy}
      group by x.fingerprint`);
    return [...new Set(rows.map((r) => (r.wifi ? ('wifi' as const) : ('address' as const))))].sort();
  }

  /** Daily: networks not used for 90 days are forgotten. */
  async prune() {
    const before = new Date(Date.now() - NETWORK_KEEP_DAYS * 86_400_000);
    const gone = await this.db
      .delete(userNetworks)
      .where(lt(userNetworks.lastSeenAt, before))
      .returning({ userId: userNetworks.userId });
    return { forgotten: gone.length };
  }

  /** Waits for writes under way: for tests, and before the database closes. */
  async settled() {
    while (this.running.size) await Promise.allSettled([...this.running]);
  }

  async beforeApplicationShutdown() {
    await Promise.race([this.settled(), new Promise((resolve) => setTimeout(resolve, SHUTDOWN_WAIT_MS).unref())]);
  }
}
