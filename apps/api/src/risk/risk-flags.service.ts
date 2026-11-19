import {
  Inject,
  Injectable,
  Logger,
  type BeforeApplicationShutdown,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import { RISK_FLAG_INFO, type RiskFlagKind } from '@jiffo/shared';
import { haversineMeters } from '../adapters/maps';
import { hmacSha256 } from '../common/crypto';
import { keyFor, subKey } from '../common/keys';
import { matchesLegalName } from '../common/names';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { CountriesService } from '../countries/countries.service';
import { DB, type Db } from '../db/database.module';
import { openField } from '../db/fields';
import {
  agentApplications,
  deposits,
  devices,
  errandStops,
  errands,
  payoutAccounts,
  riskFlagErrands,
  riskFlags,
  users,
} from '../db/schema';
import { moderate } from './moderation';
import { NetworksService } from './networks.service';

type ErrandRow = typeof errands.$inferSelect;
type Stop = { kind: string; lat: number; lng: number };

/** How two accounts were found on one phone: the same install of an app, the same phone key, or the phone's id. */
export type SharedBy = 'install' | 'key' | 'phone';

interface Raise {
  countryCode: string;
  kind: RiskFlagKind;
  dedupeKey: string;
  userId: string;
  otherUserId?: string | null;
  details?: Record<string, unknown>;
  errandIds?: string[];
}

/** Older payout accounts fingerprinted at a time. */
const BACKFILL_BATCH = 200;

/**
 * A flag's details with a later finding's: lists are joined, each item once (the ways a phone was shared,
 * the bank accounts two agents share); anything else takes the later value.
 */
function mergeDetails(earlier: Record<string, unknown>, later: Record<string, unknown>) {
  const out: Record<string, unknown> = { ...earlier };
  for (const [key, value] of Object.entries(later)) {
    const before = earlier[key];
    if (Array.isArray(before) && Array.isArray(value)) {
      const seen = new Map([...before, ...value].map((item) => [JSON.stringify(item), item]));
      out[key] = [...seen.values()];
    } else {
      out[key] = value;
    }
  }
  return out;
}

/** How long shutting down waits for checks still running. */
const SHUTDOWN_WAIT_MS = 5_000;

/** Two accounts in a fixed order, so A with B and B with A are one flag. */
const pairKey = (a: string, b: string) => [a, b].sort().join(':');

/**
 * Fraud flags (docs/security-plan.md, E5, E6, I3): errands and accounts that look like fraud, raised for a
 * person to decide in the Risk or verification queue. Each check runs beside the request that set it off, so
 * neither waits for it nor fails with it; a flag refuses nothing by itself.
 */
@Injectable()
export class RiskFlagsService implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly logger = new Logger(RiskFlagsService.name);
  private readonly running = new Set<Promise<unknown>>();
  /** Keys of their own, derived from the ID fingerprint key: phones' ids and bank accounts are never kept. */
  private readonly phoneKey: Buffer;
  private readonly accountKey: Buffer;

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly countries: CountriesService,
    @Inject(APP_CONFIG) config: AppConfig,
    private readonly networks: NetworksService,
  ) {
    const base = keyFor(config, 'idFingerprint');
    this.phoneKey = subKey(base, 'jiffo phone fingerprint');
    this.accountKey = subKey(base, 'jiffo payout account fingerprint');
  }

  /** Accounts saved before fingerprints were kept get theirs, beside start-up. */
  onApplicationBootstrap() {
    this.later('payout fingerprints', () => this.fingerprintOldAccounts());
  }

  /** A keyed hash of the phone's own id, which both apps on one phone send (iOS: per vendor; Android: per key). */
  phoneFingerprint(platform: string, phoneId: string | undefined) {
    return phoneId ? hmacSha256(this.phoneKey.toString('hex'), `${platform}:${phoneId}`) : null;
  }

  /** A keyed hash of a bank account, to find one saved by two agents without reading account numbers. */
  accountFingerprint(bankCode: string, accountNumber: string) {
    return hmacSha256(this.accountKey.toString('hex'), `${bankCode}:${accountNumber}`);
  }

  /** Waits for the checks under way: for tests, and for a clean shutdown. */
  async settled() {
    while (this.running.size) await Promise.allSettled([...this.running]);
  }

  /** Checks under way finish before the database closes, for up to a few seconds. */
  async beforeApplicationShutdown() {
    await Promise.race([this.settled(), new Promise((resolve) => setTimeout(resolve, SHUTDOWN_WAIT_MS).unref())]);
  }

  /** Runs a check beside the request: never waited for, and a failure is only logged. */
  private later(what: string, check: () => Promise<unknown>) {
    const run: Promise<unknown> = check()
      .catch((error: Error) => this.logger.warn(`Risk check ${what} failed: ${error.message}`))
      .finally(() => this.running.delete(run));
    this.running.add(run);
  }

  /* ---------- What sets the checks off ---------- */

  /** A new errand: moderation (E5). */
  errandCreated(errand: Pick<ErrandRow, 'id' | 'countryCode' | 'customerId' | 'description'>, stops: Stop[]) {
    this.later(`errand ${errand.id}`, () => this.moderateErrand(errand, stops));
  }

  /** An errand moved: an agent accepting it pairs them with the customer, and finishing it ends the run (E6). */
  errandChanged(before: ErrandRow, after: ErrandRow) {
    if (after.agentId && before.agentId !== after.agentId) {
      this.later(`pairing on ${after.id}`, () => this.checkPairing(after as ErrandRow & { agentId: string }));
    }
    if (after.status === 'completed' && before.status !== 'completed') {
      this.later(`speed of ${after.id}`, () => this.checkSpeed(after));
    }
  }

  /** A sign-in, or a phone key saved: the phone may be another account's too (I3). */
  phoneUsed(userId: string, deviceId: string) {
    this.later(`phone ${deviceId}`, () => this.checkSharedPhone(userId, deviceId));
  }

  /** Someone started an agent application: phones they share with others now count (I3). */
  becameApplicant(userId: string) {
    this.later(`phones of ${userId}`, async () => {
      const own = await this.db.select({ id: devices.id }).from(devices).where(eq(devices.userId, userId));
      for (const device of own) await this.checkSharedPhone(userId, device.id);
    });
  }

  /**
   * The identity provider found this person on other checks (I3): a face on another account's check, under
   * another ID, is flagged for verification. The same ID number is the one-account-per-ID check's to stop.
   */
  relatedChecks(userId: string, related: Array<{ reference: string; face: boolean; idNumber: boolean }>) {
    this.later(`checks related to ${userId}`, () => this.checkSameFace(userId, related));
  }

  /** A payout account saved: another agent may have saved the same one (I3). */
  payoutAccountSaved(userId: string, fingerprint: string) {
    this.later(`payout account of ${userId}`, () => this.checkSharedAccount(userId, fingerprint));
  }

  /* ---------- The checks ---------- */

  private async risk(countryCode: string) {
    return (await this.countries.currentSettings(countryCode)).settings.risk;
  }

  private async moderateErrand(
    errand: Pick<ErrandRow, 'id' | 'countryCode' | 'customerId' | 'description'>,
    stops: Stop[],
  ) {
    const base = { countryCode: errand.countryCode, dedupeKey: errand.id, userId: errand.customerId };
    for (const finding of moderate(errand.description)) {
      await this.raise({ ...base, kind: finding.kind, details: { words: finding.words }, errandIds: [errand.id] });
    }
    const pickup = stops.find((s) => s.kind === 'pickup');
    const dropoff = stops.findLast((s) => s.kind === 'dropoff');
    const { samePlaceMeters } = await this.risk(errand.countryCode);
    if (pickup && dropoff && samePlaceMeters > 0) {
      const metres = Math.round(haversineMeters(pickup, dropoff));
      if (metres < samePlaceMeters) {
        await this.raise({ ...base, kind: 'same_place', details: { metres }, errandIds: [errand.id] });
      }
    }
  }

  private async checkPairing(errand: ErrandRow & { agentId: string }) {
    const pair = { customerId: errand.customerId, agentId: errand.agentId };
    const by = await this.sharedPhone(pair.customerId, pair.agentId);
    if (by.length) await this.raisePair('pair_shared_phone', errand, { by });
    if (await this.toppedUpFromAgent(pair.customerId, pair.agentId)) await this.raisePair('pair_shared_bank', errand);
    const { sharedNetworkDays, busyNetworkAccounts } = await this.risk(errand.countryCode);
    const networks = await this.networks.sharedBetween(
      pair.customerId,
      pair.agentId,
      sharedNetworkDays,
      busyNetworkAccounts,
    );
    if (networks.length) await this.raisePair('pair_shared_network', errand, { by: networks });
    await this.checkRepeats(errand);
  }

  /**
   * Flags about a customer and agent are one per pair: their later errands join it while it stands, and a
   * pair a reviewer cleared isn't flagged for it again.
   */
  private async raisePair(
    kind: 'pair_shared_phone' | 'pair_shared_bank' | 'pair_shared_network',
    errand: ErrandRow & { agentId: string },
    details: Record<string, unknown> = {},
  ) {
    await this.raise({
      countryCode: errand.countryCode,
      kind,
      dedupeKey: `${errand.customerId}:${errand.agentId}`,
      userId: errand.customerId,
      otherUserId: errand.agentId,
      details,
      errandIds: [errand.id],
    });
  }

  /** How the two accounts were seen on one phone, if they were. */
  private async sharedPhone(a: string, b: string): Promise<SharedBy[]> {
    const rows = await this.db.execute<{ install: boolean; key: boolean; phone: boolean }>(sql`
      select bool_or(x.device_key = y.device_key and x.app = y.app) as install,
             bool_or(x.public_key is not null and x.public_key = y.public_key) as key,
             bool_or(x.phone_fingerprint is not null and x.phone_fingerprint = y.phone_fingerprint) as phone
      from ${devices} x join ${devices} y
        on (x.device_key = y.device_key and x.app = y.app)
        or (x.public_key = y.public_key)
        or (x.phone_fingerprint = y.phone_fingerprint)
      where x.user_id = ${a} and y.user_id = ${b}`);
    const row = rows.rows[0];
    return (['install', 'key', 'phone'] as const).filter((k) => row?.[k]);
  }

  /**
   * Whether the customer's wallet was topped up from a bank account in the name on one of the agent's payout
   * accounts: a transfer whose sender isn't the customer, named as the agent's bank names them.
   */
  private async toppedUpFromAgent(customerId: string, agentId: string) {
    const [senders, accounts] = await Promise.all([
      this.db
        .selectDistinct({ name: deposits.senderName })
        .from(deposits)
        .where(and(eq(deposits.userId, customerId), eq(deposits.senderMismatch, true), isNotNull(deposits.senderName))),
      this.db
        .select({ name: payoutAccounts.accountName })
        .from(payoutAccounts)
        .where(eq(payoutAccounts.userId, agentId)),
    ]);
    return senders.some((s) => accounts.some((a) => matchesLegalName(s.name!, a.name)));
  }

  /**
   * The same customer and agent pairing again and again (E6): their errands accepted within the days Settings
   * give, counted from the last time a reviewer cleared the pair. While a flag stands, later errands join it.
   */
  private async checkRepeats(errand: ErrandRow & { agentId: string }) {
    const pair = and(eq(riskFlags.userId, errand.customerId), eq(riskFlags.otherUserId, errand.agentId));
    const earlier = await this.db
      .select({ id: riskFlags.id, status: riskFlags.status, decidedAt: riskFlags.decidedAt })
      .from(riskFlags)
      .where(and(eq(riskFlags.kind, 'repeat_pairing'), pair))
      .orderBy(desc(riskFlags.createdAt));
    const latest = earlier[0];
    if (latest && latest.status !== 'cleared') {
      await this.link(latest.id, [errand.id]);
      return;
    }
    const { repeatPairingErrands, repeatPairingDays } = await this.risk(errand.countryCode);
    const windowStart = new Date(Date.now() - repeatPairingDays * 86_400_000);
    const since = latest?.decidedAt && latest.decidedAt > windowStart ? latest.decidedAt : windowStart;
    const together = await this.db
      .select({ id: errands.id })
      .from(errands)
      .where(
        and(
          eq(errands.customerId, errand.customerId),
          eq(errands.agentId, errand.agentId),
          gte(errands.acceptedAt, since),
        ),
      );
    if (together.length < repeatPairingErrands) return;
    await this.raise({
      countryCode: errand.countryCode,
      kind: 'repeat_pairing',
      // A round each time, so a pair cleared once can be flagged again after as many more.
      dedupeKey: `${errand.customerId}:${errand.agentId}:${earlier.length + 1}`,
      userId: errand.customerId,
      otherUserId: errand.agentId,
      details: { days: repeatPairingDays },
      errandIds: together.map((e) => e.id),
    });
  }

  /**
   * A high-value errand finished unusually fast (E6): from accepted to delivered quicker than Settings allow,
   * or than its stops could be driven between at 60 km/h in a straight line.
   */
  private async checkSpeed(errand: ErrandRow) {
    if (!errand.agentId || !errand.acceptedAt) return;
    const { fastHighValueKobo, fastErrandMinutes } = await this.risk(errand.countryCode);
    const valueKobo = errand.feeKobo + (errand.itemAmountKobo ?? 0);
    if (valueKobo < fastHighValueKobo) return;
    const doneAt = errand.deliveredAt ?? errand.completedAt ?? new Date();
    const minutes = (doneAt.getTime() - errand.acceptedAt.getTime()) / 60_000;
    const stops = await this.db
      .select({ lat: errandStops.lat, lng: errandStops.lng })
      .from(errandStops)
      .where(eq(errandStops.errandId, errand.id))
      .orderBy(asc(errandStops.seq));
    let km = 0;
    for (let i = 1; i < stops.length; i += 1) km += haversineMeters(stops[i - 1]!, stops[i]!) / 1000;
    const leastMinutes = Math.max(fastErrandMinutes, km);
    if (minutes >= leastMinutes) return;
    await this.raise({
      countryCode: errand.countryCode,
      kind: 'fast_high_value',
      dedupeKey: errand.id,
      userId: errand.customerId,
      otherUserId: errand.agentId,
      details: {
        valueKobo,
        minutes: Math.round(minutes * 10) / 10,
        leastMinutes: Math.round(leastMinutes * 10) / 10,
      },
      errandIds: [errand.id],
    });
  }

  /**
   * Other accounts seen on this phone (I3): the same install of an app, the same phone key, or the phone's id
   * both apps send. Flagged when either account is an agent's, counting anyone who has started an application:
   * a family's customer accounts on one phone are ordinary, and there are no promotions to abuse yet.
   */
  private async checkSharedPhone(userId: string, deviceId: string) {
    const [device] = await this.db
      .select({
        deviceKey: devices.deviceKey,
        app: devices.app,
        publicKey: devices.publicKey,
        phoneFingerprint: devices.phoneFingerprint,
        countryCode: users.countryCode,
      })
      .from(devices)
      .innerJoin(users, eq(users.id, devices.userId))
      .where(eq(devices.id, deviceId));
    if (!device) return;
    const same: SQL[] = [and(eq(devices.deviceKey, device.deviceKey), eq(devices.app, device.app))!];
    if (device.publicKey) same.push(eq(devices.publicKey, device.publicKey));
    if (device.phoneFingerprint) same.push(eq(devices.phoneFingerprint, device.phoneFingerprint));
    const others = await this.db
      .selectDistinct({ userId: devices.userId })
      .from(devices)
      .where(and(ne(devices.userId, userId), or(...same)));
    if (!others.length) return;
    const agents = new Set(
      (
        await this.db
          .select({ userId: agentApplications.userId })
          .from(agentApplications)
          .where(inArray(agentApplications.userId, [userId, ...others.map((o) => o.userId)]))
      ).map((r) => r.userId),
    );
    for (const other of others) {
      if (!agents.has(userId) && !agents.has(other.userId)) continue;
      const by = await this.sharedPhone(userId, other.userId);
      if (!by.length) continue;
      await this.raise({
        countryCode: device.countryCode,
        kind: 'shared_phone',
        dedupeKey: pairKey(userId, other.userId),
        userId,
        otherUserId: other.userId,
        details: { by },
      });
    }
  }

  private async checkSameFace(userId: string, related: Array<{ reference: string; face: boolean; idNumber: boolean }>) {
    const faces = related.filter((r) => r.face).slice(0, 50);
    if (!faces.length) return;
    const [me] = await this.db.select({ countryCode: users.countryCode }).from(users).where(eq(users.id, userId));
    if (!me) return;
    const references = faces.map((r) => r.reference);
    // Whose checks they were: customers' and agents' current checks, and every check started lately.
    const { rows } = await this.db.execute<{ user_id: string; reference: string }>(sql`
      select user_id, reference from customer_verifications where reference in ${references}
      union select user_id, identity_reference from agent_applications where identity_reference in ${references}
      union select user_id, reference from identity_attempts where kind = 'start' and reference in ${references}`);
    const owners = new Map<string, boolean>();
    for (const row of rows) {
      if (row.user_id === userId) continue;
      const match = faces.find((f) => f.reference === row.reference)!;
      owners.set(row.user_id, (owners.get(row.user_id) ?? false) || match.idNumber);
    }
    for (const [other, sameIdNumber] of owners) {
      await this.raise({
        countryCode: me.countryCode,
        kind: 'same_face',
        dedupeKey: pairKey(userId, other),
        userId,
        otherUserId: other,
        details: { sameIdNumber },
      });
    }
  }

  /** One bank account saved by two agents (I3), found by its fingerprint. */
  private async checkSharedAccount(userId: string, fingerprint: string) {
    const [me] = await this.db.select({ countryCode: users.countryCode }).from(users).where(eq(users.id, userId));
    if (!me) return;
    const others = await this.db
      .selectDistinct({
        userId: payoutAccounts.userId,
        bankName: payoutAccounts.bankName,
        last4: payoutAccounts.accountLast4,
      })
      .from(payoutAccounts)
      .where(and(eq(payoutAccounts.accountFingerprint, fingerprint), ne(payoutAccounts.userId, userId)));
    for (const other of others) {
      await this.raise({
        countryCode: me.countryCode,
        kind: 'shared_payout_account',
        dedupeKey: pairKey(userId, other.userId),
        userId,
        otherUserId: other.userId,
        details: { accounts: [{ bankName: other.bankName, last4: other.last4 }] },
      });
    }
  }

  /* ---------- Raising ---------- */

  /**
   * Raises a flag once for what it is about. Raised again while it stands, its details are brought up to date
   * and the errands join it; once a reviewer cleared it, nothing is added to it.
   */
  private async raise(input: Raise) {
    const [created] = await this.db
      .insert(riskFlags)
      .values({
        countryCode: input.countryCode,
        queue: RISK_FLAG_INFO[input.kind].queue,
        kind: input.kind,
        dedupeKey: input.dedupeKey,
        userId: input.userId,
        otherUserId: input.otherUserId ?? null,
        details: input.details ?? {},
      })
      .onConflictDoNothing({ target: [riskFlags.kind, riskFlags.dedupeKey] })
      .returning({ id: riskFlags.id });
    let id = created?.id;
    if (created) {
      this.logger.log(`Flagged ${input.kind} for ${RISK_FLAG_INFO[input.kind].queue}`);
    } else {
      id = await this.db.transaction(async (tx) => {
        const [standing] = await tx
          .select({ id: riskFlags.id, details: riskFlags.details })
          .from(riskFlags)
          .where(
            and(
              eq(riskFlags.kind, input.kind),
              eq(riskFlags.dedupeKey, input.dedupeKey),
              ne(riskFlags.status, 'cleared'),
            ),
          )
          .for('update');
        if (!standing) return undefined;
        await tx
          .update(riskFlags)
          .set({ details: mergeDetails(standing.details, input.details ?? {}), updatedAt: new Date() })
          .where(eq(riskFlags.id, standing.id));
        return standing.id;
      });
    }
    if (id && input.errandIds?.length) await this.link(id, input.errandIds);
    return id ?? null;
  }

  private async link(flagId: string, errandIds: string[]) {
    await this.db
      .insert(riskFlagErrands)
      .values(errandIds.map((errandId) => ({ flagId, errandId })))
      .onConflictDoNothing();
  }

  /**
   * Fingerprints for accounts saved before they were kept, a few hundred at a time. Each account number is
   * opened on its own, so one that can't be read (sealed under another key) is passed over, not the rest.
   */
  async fingerprintOldAccounts() {
    let after: string | null = null;
    let skipped = 0;
    for (;;) {
      const { rows }: { rows: Array<{ id: string; bank_code: string; account_number: string }> } = await this.db
        .execute(sql`select id, bank_code, account_number from ${payoutAccounts}
          where account_fingerprint is null ${after === null ? sql`` : sql`and id > ${after}`}
          order by id limit ${BACKFILL_BATCH}`);
      for (const row of rows) {
        try {
          const number = openField('payout_accounts.account_number', row.account_number);
          await this.db
            .update(payoutAccounts)
            .set({ accountFingerprint: this.accountFingerprint(row.bank_code, number) })
            .where(and(eq(payoutAccounts.id, row.id), isNull(payoutAccounts.accountFingerprint)));
        } catch (error) {
          skipped += 1;
          this.logger.warn(`Could not fingerprint payout account ${row.id}: ${(error as Error).message}`);
        }
      }
      if (rows.length < BACKFILL_BATCH) break;
      after = rows[rows.length - 1]!.id;
    }
    if (skipped) this.logger.warn(`${skipped} older payout accounts were left without a fingerprint`);
  }
}
