import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  bestAssignment,
  DEFAULT_MATCHING_SETTINGS,
  formatNaira,
  offerCounts,
  pausesOffers,
  searchRadiusKm,
  searchStep,
  type CountrySettings,
} from '@jiffo/shared';
import { and, asc, desc, eq, gt, gte, inArray, isNull, lt, lte, ne, or, sql } from 'drizzle-orm';
import { haversineMeters } from '../adapters/maps';
import { AgentsService } from '../agents/agents.service';
import { PresenceService } from '../agents/presence.service';
import { notFound } from '../common/errors';
import { CountriesService } from '../countries/countries.service';
import { MatchingPlacesService } from '../countries/matching-places.service';
import { DB, type Db } from '../db/database.module';
import {
  agentPresence,
  customerVerifications,
  errandBroadcasts,
  errandOffers,
  errandRatings,
  errandStops,
  errands,
  users,
} from '../db/schema';
import { agentEarnsKobo } from '../errands/agent-earns';
import { stopArea } from '../errands/errand-view';
import { PushService } from '../push/push.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { ERRAND_TIMERS, type ErrandTimers } from '../timers/errand-timers';
import { AgentLocations } from './agent-locations';
import { CandidatesService } from './candidates.service';
import { MatchingRedis } from './matching-redis';
import { RankingService, type Ranked } from './ranking.service';

type ErrandRow = typeof errands.$inferSelect;
type OfferRow = typeof errandOffers.$inferSelect;

/**
 * A look again for an errand still waiting is kept this much longer than its timer takes, so a timer that comes
 * late doesn't let a second one start meanwhile.
 */
const RETRY_SLACK_SECONDS = 30;
/** An offer still open this long after its time was up has lost its timer: the sweep ends it. */
const STALE_AFTER_MS = 30_000;
const retryKey = (errandId: string) => `offers:retry:${errandId}`;
/** The batch waiting in an errand's state (M5). */
const batchKey = (errand: Pick<ErrandRow, 'countryCode' | 'stateCode'>) =>
  `offers:batch:${errand.countryCode}:${errand.stateCode}`;
/** Errands in one state's batch at most; any more wait for the next. */
const BATCH_MAX = 50;
/** How long a running batch holds its state's mark at most, should it never finish. */
const BATCH_RUNNING_SECONDS = 60;

/**
 * Ranked agents in the order offering asks them: those within the first of these search steps by score, then
 * those in the next step out who aren't nearer, and so on.
 */
function ringOrder(ranked: Ranked[], stepsKm: number[]) {
  return stepsKm.flatMap((km, j) =>
    ranked.filter((r) => r.straightMeters <= km * 1000 && (j === 0 || r.straightMeters > stepsKm[j - 1]! * 1000)),
  );
}

/** The ranked agents within the nearest search step that has any, by score: whom a first offer would ask. */
function nearestRing(ranked: Ranked[], stepsKm: number[]) {
  for (const km of stepsKm) {
    const within = ranked.filter((r) => r.straightMeters <= km * 1000);
    if (within.length) return within;
  }
  return [];
}

/**
 * Urgent errands offered to one agent at a time (docs/matching.md, M6): the best-ranked agent who may take it
 * gets a ringing offer for the Matching offer window, then the next if they decline or let it run out. An agent
 * who said no at this fee isn't asked again; a raised fee asks everyone again. Accepting the offer is checked in
 * the accept transaction (ErrandsService), and every offer is kept, with its score and parts (M15).
 */
@Injectable()
export class OffersService {
  private readonly logger = new Logger('Offers');

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ERRAND_TIMERS) private readonly timers: ErrandTimers,
    private readonly countries: CountriesService,
    private readonly places: MatchingPlacesService,
    private readonly ranking: RankingService,
    private readonly push: PushService,
    private readonly realtime: RealtimeGateway,
    private readonly presence: PresenceService,
    private readonly locations: AgentLocations,
    private readonly redis: MatchingRedis,
    private readonly agents: AgentsService,
    private readonly candidates: CandidatesService,
  ) {}

  /**
   * After an errand changed: while an urgent one waits, it is offered (or offered again, its fee raised or its
   * agent gone); once it has left waiting, an offer still open for it is withdrawn. Never fails the change.
   */
  async errandChanged(errand: ErrandRow) {
    if (errand.status === 'requested') {
      // Open to everyone at a fee it no longer has (raised): offered one at a time again, as those told hear.
      if (errand.broadcastFeeKobo !== null && errand.broadcastFeeKobo !== errand.feeKobo) {
        await this.reopened(errand).catch((error: Error) =>
          this.logger.warn(`Telling agents errand ${errand.id} is offered again failed: ${error.message}`),
        );
      }
      if (errand.urgent) await this.dispatch(errand.id);
      return;
    }
    await this.withdraw(errand).catch((error: Error) =>
      this.logger.warn(`Withdrawing the offer for errand ${errand.id} failed: ${error.message}`),
    );
  }

  /** The offer standing for an errand, if any: open, and its time not up. */
  private async openFor(errandId: string) {
    const [open] = await this.db
      .select({ id: errandOffers.id })
      .from(errandOffers)
      .where(
        and(
          eq(errandOffers.errandId, errandId),
          eq(errandOffers.status, 'open'),
          gt(errandOffers.expiresAt, new Date()),
        ),
      );
    return open ?? null;
  }

  /**
   * Offers a waiting urgent errand to the best-ranked agent who may take it now, hasn't said no to it at this
   * fee and holds no other offer, unless someone holds an offer for it already. With no one, or if finding
   * them fails, looks again soon. Never fails: what went wrong is logged.
   */
  async dispatch(errandId: string): Promise<void> {
    const known: { version?: number; retrySeconds?: number } = {};
    try {
      await this.offerNext(errandId, known);
    } catch (error) {
      this.logger.warn(`Offering errand ${errandId} failed, looking again soon: ${(error as Error).message}`);
      await this.later(
        errandId,
        known.version ?? 0,
        known.retrySeconds ?? DEFAULT_MATCHING_SETTINGS.dispatchRetrySeconds,
      ).catch((e: Error) => this.logger.warn(`Looking again at errand ${errandId} failed: ${e.message}`));
    }
  }

  private async offerNext(errandId: string, known: { version?: number; retrySeconds?: number }) {
    const [errand] = await this.db.select().from(errands).where(eq(errands.id, errandId));
    if (!errand || errand.status !== 'requested' || !errand.urgent) return;
    known.version = errand.version;
    // Where it is: its area's, city's and state's own values, then the country's (M14).
    const rules = await this.places.rulesFor(errand);
    known.retrySeconds = rules.dispatchRetrySeconds;
    // Offers off for the country: the errand is on the board instead. Looked at again soon all the same, so
    // turning offers on offers the errands waiting then.
    if (!rules.offers) return this.later(errandId, errand.version, rules.dispatchRetrySeconds);
    // An offer for it still open after its time was up (its timer late, or lost) no longer holds it.
    const timeUp = await this.db
      .update(errandOffers)
      .set({ status: 'expired' })
      .where(
        and(
          eq(errandOffers.errandId, errandId),
          eq(errandOffers.status, 'open'),
          lte(errandOffers.expiresAt, new Date()),
        ),
      )
      .returning();
    for (const o of timeUp) await this.ended(o, { offerAgain: false });
    if (await this.openFor(errandId)) return;
    // Open to everyone at this fee already (M8): tell those who have arrived since.
    if (errand.broadcastFeeKobo === errand.feeKobo) return this.toEveryone(errand, rules);
    // Left out before the shortlist is drawn up, so they never take the places of agents who could be asked:
    // who said no to it at this fee, and who holds another offer (one at a time, kept by the database too).
    const [passed, busy, made] = await Promise.all([
      this.passed(errand),
      this.notToOffer(errand.countryCode),
      this.offersMade(errand),
    ]);
    // Every step has had its offers: to everyone at once.
    const step = searchStep(made.n, rules);
    if (!step) return this.toEveryone(errand, rules);
    const skip = new Set([...passed.map((p) => p.agentId), ...busy]);
    // Ranked once, as far as the last step reaches, and offered from this step's radius out: further out at once
    // where no one nearer can be asked.
    const ranked = await this.ranking.ranked(errandId, skip, rules.searchStepsKm.at(-1), rules);
    for (const [i, r] of ringOrder(ranked, rules.searchStepsKm.slice(step.index)).entries()) {
      const outcome = await this.offerTo(errand, r, i + 1, rules);
      if (outcome === 'offered' || outcome === 'stop') return;
      // The agent was offered another errand meanwhile, or someone else offered this errand first.
      if (await this.openFor(errandId)) return;
    }
    // No one can take it now: look again soon.
    await this.later(errandId, errand.version, rules.dispatchRetrySeconds);
  }

  /**
   * Offers the errand to the agent, at their place in the ranking: 'offered', 'taken' when the agent holds another
   * offer or the errand already has one (the database keeps one open per agent and per errand), or 'stop' when the
   * errand no longer waits at the fee it was ranked at.
   */
  private async offerTo(
    errand: ErrandRow,
    r: Ranked,
    rank: number,
    rules: CountrySettings['matching'],
  ): Promise<'offered' | 'taken' | 'stop'> {
    const now = new Date();
    const offer = await this.db.transaction(async (tx) => {
      // The errand as it is now, locked as accepting locks it: still waiting, at the fee ranked for.
      const [still] = await tx
        .select({ status: errands.status, feeKobo: errands.feeKobo })
        .from(errands)
        .where(eq(errands.id, errand.id))
        .for('update');
      if (still?.status !== 'requested' || still.feeKobo !== errand.feeKobo) return 'stop' as const;
      const [row] = await tx
        .insert(errandOffers)
        .values({
          errandId: errand.id,
          agentId: r.agentId,
          countryCode: errand.countryCode,
          feeKobo: errand.feeKobo,
          rank,
          score: r.score,
          parts: { ...r.parts },
          travelSeconds: r.travel.durationSeconds,
          travelEstimated: r.travel.estimated,
          straightMeters: r.straightMeters,
          // Back to back (M10), never: the agent can't take it until they finish the one they hold.
          counts:
            !r.backToBack &&
            offerCounts({ straightMeters: r.straightMeters, offeredAt: now, onlineSince: r.onlineSince }, rules),
          backToBack: r.backToBack,
          offeredAt: now,
          expiresAt: new Date(now.getTime() + rules.offerSeconds * 1000),
        })
        .onConflictDoNothing()
        .returning();
      return row ?? null;
    });
    if (offer === 'stop') return 'stop';
    if (!offer) return 'taken';
    await this.timers.schedule(
      { errandId: errand.id, event: 'offer_expire', status: 'requested', version: errand.version, offerId: offer.id },
      rules.offerSeconds * 1000,
    );
    // The offer stands if the push fails: the agent's app also shows it (GET /v1/agent/offers/current).
    await this.tell(offer, errand, r).catch((error: Error) =>
      this.logger.warn(`Telling agent ${offer.agentId} of an offer failed: ${error.message}`),
    );
    this.searchChanged(errand);
    return 'offered';
  }

  /**
   * A new urgent errand (docs/matching.md, M5): its first offer waits a few seconds for its state's batch, so
   * errands sent about the same time are matched together. The customer's request doesn't wait for any of it.
   */
  async errandCreated(errand: ErrandRow) {
    if (errand.status !== 'requested' || !errand.urgent) return;
    try {
      const rules = await this.places.stateRules(errand.countryCode, errand.stateCode);
      if (!rules.offers) return await this.dispatch(errand.id);
      await this.batchSoon(errand, rules);
    } catch (error) {
      this.logger.warn(`Batching errand ${errand.id} failed, offering it alone: ${(error as Error).message}`);
      await this.dispatch(errand.id);
    }
  }

  /**
   * Starts the errand's state's batch, unless one is waiting or running already, which the errand joins (one that
   * is running leaves it to the next). If its timer can't be set, the mark comes off again, so the errands sent
   * after aren't left waiting on a batch that never comes.
   */
  private async batchSoon(errand: ErrandRow, rules: CountrySettings['matching']) {
    const key = batchKey(errand);
    const first = await this.redis.client
      .set(key, '1', 'EX', rules.batchSeconds + RETRY_SLACK_SECONDS, 'NX')
      .catch(() => 'OK');
    if (first !== 'OK') return;
    try {
      await this.timers.schedule(
        { errandId: errand.id, event: 'offer_batch', status: 'requested', version: errand.version },
        rules.batchSeconds * 1000,
      );
    } catch (error) {
      await this.redis.client.del(key).catch(() => undefined);
      throw error;
    }
  }

  /**
   * The batch for the errand's state is due (M5): the urgent errands there still waiting for a first offer get
   * agents together, as many as can get one and with the highest total score, each agent in one assignment at
   * most (bestAssignment, in @jiffo/shared). Each errand's agents are those in its nearest search step with anyone
   * in it, as offering one at a time would ask. The rest are offered one at a time from here, which looks again
   * soon when no one is free.
   */
  async runBatch(errandId: string) {
    const [trigger] = await this.db.select().from(errands).where(eq(errands.id, errandId));
    if (!trigger) return;
    const key = batchKey(trigger);
    // Held while it runs, so an errand sent meanwhile waits for the next batch rather than starting one beside it.
    await this.redis.client.set(key, '1', 'EX', BATCH_RUNNING_SECONDS).catch(() => undefined);
    const done = new Set<string>();
    try {
      // How long the batch waits is the state's; each errand is matched by the rules where it is (M14).
      const country = (await this.countries.currentSettings(trigger.countryCode)).settings.matching;
      const rules = await this.places.stateRules(trigger.countryCode, trigger.stateCode, country);
      const waiting = await this.waitingForBatch(trigger, rules);
      for (const e of waiting) done.add(e.id);
      if (!waiting.length) return;
      await this.matchBatch(trigger, waiting, country).catch(async (error: Error) => {
        this.logger.warn(`The batch for ${trigger.countryCode}-${trigger.stateCode} failed: ${error.message}`);
        for (const e of waiting) await this.dispatch(e.id);
      });
    } finally {
      await this.redis.client.del(key).catch(() => undefined);
      // Errands sent while it ran get the next batch.
      await this.nextBatch(trigger, done).catch((error: Error) =>
        this.logger.warn(
          `Starting the next batch for ${trigger.countryCode}-${trigger.stateCode} failed: ${error.message}`,
        ),
      );
    }
  }

  /**
   * The state's urgent errands waiting for a first offer, sent within the batch's window: never offered, not open to
   * everyone, and not looking again on their own (an errand no batch could match is offered one at a time from then).
   */
  private async waitingForBatch(trigger: ErrandRow, rules: CountrySettings['matching']) {
    const since = new Date(Date.now() - (rules.batchSeconds + RETRY_SLACK_SECONDS) * 1000);
    const rows = await this.db
      .select()
      .from(errands)
      .where(
        and(
          eq(errands.countryCode, trigger.countryCode),
          eq(errands.stateCode, trigger.stateCode),
          eq(errands.status, 'requested'),
          eq(errands.urgent, true),
          isNull(errands.broadcastFeeKobo),
          gt(errands.createdAt, since),
          sql`not exists (select 1 from ${errandOffers} o where o.errand_id = ${errands.id})`,
        ),
      )
      .orderBy(asc(errands.createdAt))
      .limit(BATCH_MAX);
    const looking = await Promise.all(rows.map((e) => this.redis.client.exists(retryKey(e.id)).catch(() => 0)));
    return rows.filter((_, i) => !looking[i]);
  }

  /** After a batch: if errands arrived while it ran, the next batch starts for them. */
  private async nextBatch(trigger: ErrandRow, done: ReadonlySet<string>) {
    const rules = await this.places.stateRules(trigger.countryCode, trigger.stateCode);
    if (!rules.offers) return;
    const next = (await this.waitingForBatch(trigger, rules)).find((e) => !done.has(e.id));
    if (next) await this.batchSoon(next, rules);
  }

  /** Assigns the batch's errands their agents together, and offers the rest one at a time. */
  private async matchBatch(trigger: ErrandRow, waiting: ErrandRow[], country: CountrySettings['matching']) {
    if (!country.offers) {
      for (const e of waiting) await this.dispatch(e.id);
      return;
    }
    const skip = await this.notToOffer(trigger.countryCode);
    const rulesOf = await Promise.all(waiting.map((e) => this.places.rulesFor(e, country)));
    const options = await Promise.all(
      waiting.map(async (e, i) => {
        const rules = rulesOf[i]!;
        const ranked = await this.ranking
          .ranked(e.id, skip, rules.searchStepsKm.at(-1), rules)
          .catch((error: Error) => {
            this.logger.warn(`Ranking errand ${e.id} for its batch failed: ${error.message}`);
            return [] as Ranked[];
          });
        return nearestRing(ranked, rules.searchStepsKm);
      }),
    );
    const agents = [...new Set(options.flat().map((r) => r.agentId))];
    const column = new Map(agents.map((a, j) => [a, j]));
    const weights = options.map((rankedFor) => {
      const row: (number | null)[] = agents.map(() => null);
      for (const r of rankedFor) row[column.get(r.agentId)!] = r.score;
      return row;
    });
    const picked = bestAssignment(weights);
    // Every assignment is offered before anything else, so offering one errand alone can't take an agent the
    // batch gave another.
    const left: string[] = [];
    for (const [i, e] of waiting.entries()) {
      const j = picked[i];
      const r = j === null || j === undefined ? undefined : options[i]!.find((o) => o.agentId === agents[j]);
      const outcome = r ? await this.offerTo(e, r, options[i]!.indexOf(r) + 1, rulesOf[i]!) : 'taken';
      if (outcome === 'taken') left.push(e.id);
    }
    for (const id of left) await this.dispatch(id);
  }

  /**
   * Agents in the country not to offer an errand to now: those holding another offer (one at a time, kept by the
   * database too), and those whose offers are paused for a low acceptance rate (M9).
   */
  private async notToOffer(countryCode: string): Promise<Set<string>> {
    const [holding, paused] = await Promise.all([
      this.db
        .select({ agentId: errandOffers.agentId })
        .from(errandOffers)
        .where(and(eq(errandOffers.countryCode, countryCode), eq(errandOffers.status, 'open'))),
      this.db
        .select({ agentId: agentPresence.userId })
        .from(agentPresence)
        .where(and(eq(agentPresence.countryCode, countryCode), gt(agentPresence.offersPausedUntil, new Date()))),
    ]);
    return new Set([...holding, ...paused].map((a) => a.agentId));
  }

  /**
   * After an agent declined or let a counted offer run out (M9): if their acceptance rate is now below the level
   * admin set, their offers pause for a while, and they're told. The board, and errands open to everyone, still
   * work.
   */
  private async pauseIfLow(agentId: string, countryCode: string) {
    const rules = (await this.countries.currentSettings(countryCode)).settings.matching;
    if (rules.pauseBelowBps === null) return;
    const [presence] = await this.db
      .select({ until: agentPresence.offersPausedUntil })
      .from(agentPresence)
      .where(eq(agentPresence.userId, agentId));
    const now = new Date();
    if (presence?.until && presence.until > now) return;
    // After a pause, only offers since count toward the next, so one miss can't pause them again at once.
    const { rows } = await this.db.execute<{ taken: number; answered: number }>(sql`
      select count(*) filter (where o.status = 'accepted')::int as taken, count(*)::int as answered
      from (select status from errand_offers where agent_id = ${agentId} and counts
        and status in ('accepted', 'declined', 'expired') and offered_at > ${presence?.until ?? new Date(0)}
        order by offered_at desc limit ${rules.acceptanceOffers}) o`);
    if (!pausesOffers(rows[0] ?? { taken: 0, answered: 0 }, rules)) return;
    const until = new Date(now.getTime() + rules.pauseMinutes * 60_000);
    // Paused once: two offers ending together don't tell them twice.
    const [paused] = await this.db
      .update(agentPresence)
      .set({ offersPausedUntil: until })
      .where(
        and(
          eq(agentPresence.userId, agentId),
          or(isNull(agentPresence.offersPausedUntil), lte(agentPresence.offersPausedUntil, now)),
        ),
      )
      .returning({ userId: agentPresence.userId });
    if (!paused) return;
    this.realtime.toUser(agentId, 'agent', 'offers.paused', { until });
    await this.push.notifyUser(agentId, 'agent', {
      title: 'Offers paused',
      body: `You've declined or missed many offers lately, so Jiffo won't offer you urgent errands for ${rules.pauseMinutes} minutes. The board still works.`,
      data: { type: 'offers.paused', until: until.toISOString() },
    });
  }

  /** Agents who said no to the errand at its fee, or let the offer run out. */
  private passed(errand: ErrandRow) {
    return this.db
      .select({ agentId: errandOffers.agentId })
      .from(errandOffers)
      .where(
        and(
          eq(errandOffers.errandId, errand.id),
          inArray(errandOffers.status, ['declined', 'expired']),
          eq(errandOffers.feeKobo, errand.feeKobo),
        ),
      );
  }

  /** How many agents were offered the errand one at a time at its fee, and the furthest of them, in metres. */
  private async offersMade(errand: Pick<ErrandRow, 'id' | 'feeKobo'>) {
    const [row] = await this.db
      .select({ n: sql<number>`count(*)::int`, farthest: sql<number | null>`max(${errandOffers.straightMeters})` })
      .from(errandOffers)
      .where(
        and(
          eq(errandOffers.errandId, errand.id),
          eq(errandOffers.feeKobo, errand.feeKobo),
          ne(errandOffers.status, 'withdrawn'),
        ),
      );
    return { n: row?.n ?? 0, farthest: row?.farthest ?? null };
  }

  /**
   * How far an urgent errand's search reaches now, for its customer (M8): null while it isn't offered (offers off,
   * or not urgent). They never see who was asked or said no.
   */
  async search(errand: ErrandRow) {
    if (!errand.urgent || errand.status !== 'requested') return null;
    const rules = await this.places.rulesFor(errand);
    if (!rules.offers) return null;
    const last = rules.searchStepsKm.at(-1)!;
    // Open to everyone: as far as it was opened, as the board and accepting go by, until its next look follows a
    // change to its place's steps.
    if (errand.broadcastFeeKobo === errand.feeKobo) {
      return { radiusKm: errand.broadcastReachMeters ? errand.broadcastReachMeters / 1000 : last, everyone: true };
    }
    const made = await this.offersMade(errand);
    return { radiusKm: searchRadiusKm(made.n, made.farthest, rules), everyone: false };
  }

  /** The customer's app shows how far the search reaches: it looks again. */
  private searchChanged(errand: ErrandRow) {
    this.realtime.toUser(errand.customerId, 'customer', 'errand.search', { errandId: errand.id });
  }

  /**
   * The last step (M8): the errand is open to every agent within the last step's radius who may take it, the first
   * to accept getting it, and on the board for them. Marked once per fee; then those who haven't said no, been
   * told already or got another offer to answer are told, and it looks again soon, for agents arriving.
   */
  private async toEveryone(errand: ErrandRow, rules: CountrySettings['matching']) {
    // As far as its place's last step reaches (M14), kept with it for the board and accepting.
    const last = rules.searchStepsKm.at(-1)!;
    const reach = Math.round(last * 1000);
    if (errand.broadcastFeeKobo !== errand.feeKobo) {
      const [marked] = await this.db
        .update(errands)
        .set({
          broadcastFeeKobo: errand.feeKobo,
          broadcastReachMeters: reach,
          // The first time only: kept when a raised fee starts the search again (M15).
          openedToEveryoneAt: sql`coalesce(${errands.openedToEveryoneAt}, now())`,
        })
        .where(and(eq(errands.id, errand.id), eq(errands.status, 'requested'), eq(errands.feeKobo, errand.feeKobo)))
        .returning({ id: errands.id });
      if (!marked) return;
      this.searchChanged(errand);
      this.realtime.boardChanged(errand.id, 'added');
    } else if (errand.broadcastReachMeters !== reach) {
      // Its place's steps changed since it was opened: the board and accepting follow from now, and the customer and
      // agents watching the board are told.
      const [moved] = await this.db
        .update(errands)
        .set({ broadcastReachMeters: reach })
        .where(and(eq(errands.id, errand.id), eq(errands.status, 'requested')))
        .returning({ id: errands.id });
      if (moved) {
        this.searchChanged(errand);
        this.realtime.boardChanged(errand.id, 'changed');
      }
    }
    const [passed, told, holding] = await Promise.all([
      this.passed(errand),
      this.db
        .select({ agentId: errandBroadcasts.agentId })
        .from(errandBroadcasts)
        .where(and(eq(errandBroadcasts.errandId, errand.id), eq(errandBroadcasts.feeKobo, errand.feeKobo))),
      this.db
        .select({ agentId: errandOffers.agentId })
        .from(errandOffers)
        .where(and(eq(errandOffers.countryCode, errand.countryCode), eq(errandOffers.status, 'open'))),
    ]);
    const skip = new Set([...passed, ...told, ...holding].map((p) => p.agentId));
    const near = await this.candidates.everyoneWithin(errand.id, skip, last, undefined, rules);
    if (near.length) {
      // Told once each: an agent another look told already is left out here.
      const fresh = await this.db
        .insert(errandBroadcasts)
        .values(
          near.map((n) => ({
            errandId: errand.id,
            agentId: n.agentId,
            feeKobo: errand.feeKobo,
            straightMeters: n.straightMeters,
          })),
        )
        .onConflictDoNothing()
        .returning();
      const category = await this.countries.activeCategory(errand.countryCode, errand.categoryKey);
      for (const f of fresh) {
        await this.push
          .notifyUser(f.agentId, 'agent', {
            title: 'Urgent errand near you',
            body: `${category?.name ?? 'Errand'} · ${formatNaira(errand.feeKobo)} · ${Math.max(0.1, Math.round(f.straightMeters / 100) / 10)} km away. The first to accept gets it.`,
            data: { type: 'errand.broadcast', errandId: errand.id },
          })
          .catch((error: Error) =>
            this.logger.warn(`Telling agent ${f.agentId} of an errand failed: ${error.message}`),
          );
        this.realtime.toUser(f.agentId, 'agent', 'errand.broadcast', { errandId: errand.id });
      }
    }
    await this.later(errand.id, errand.version, rules.dispatchRetrySeconds);
  }

  /**
   * Looks at a waiting errand again soon, with one look waiting per errand: marked in Redis for longer than the
   * timer takes, so one that comes late doesn't let a second start.
   */
  private async later(errandId: string, version: number, retrySeconds: number) {
    const first = await this.redis.client
      .set(retryKey(errandId), '1', 'EX', retrySeconds + RETRY_SLACK_SECONDS, 'NX')
      .catch(() => 'OK');
    if (first !== 'OK') return;
    await this.timers.schedule(
      { errandId, event: 'offer_dispatch', status: 'requested', version, key: String(Date.now()) },
      retrySeconds * 1000,
    );
  }

  /** The look again is due: the next one may be scheduled. */
  async retry(errandId: string) {
    await this.redis.client.del(retryKey(errandId)).catch(() => undefined);
    await this.dispatch(errandId);
  }

  /**
   * Every minute: ends offers still open well after their time was up, whose timer was lost (Redis failing as it
   * was set, say), and looks again at waiting urgent errands with no offer standing and no look waiting, so
   * neither an errand nor an agent stays held by a timer that never came.
   */
  async sweep() {
    const lost = await this.db
      .update(errandOffers)
      .set({ status: 'expired' })
      .where(and(eq(errandOffers.status, 'open'), lt(errandOffers.expiresAt, new Date(Date.now() - STALE_AFTER_MS))))
      .returning();
    for (const o of lost) await this.ended(o, { offerAgain: true });
    const waiting = await this.db
      .select({ id: errands.id, countryCode: errands.countryCode, stateCode: errands.stateCode })
      .from(errands)
      .where(
        and(
          eq(errands.status, 'requested'),
          eq(errands.urgent, true),
          sql`not exists (select 1 from ${errandOffers} o where o.errand_id = ${errands.id} and o.status = 'open')`,
        ),
      );
    for (const w of waiting) {
      // Looking again on its own already, or waiting for its state's batch (M5), which offers it.
      const looking = await this.redis.client.exists(retryKey(w.id), batchKey(w)).catch(() => 0);
      if (!looking) await this.dispatch(w.id);
    }
    return lost.length;
  }

  /** Rings the agent's phone, and tells their open app. */
  private async tell(offer: OfferRow, errand: ErrandRow, ranked: Ranked) {
    const category = await this.countries.activeCategory(errand.countryCode, errand.categoryKey);
    const minutes = Math.max(1, Math.round(ranked.travel.durationSeconds / 60));
    await this.push.notifyUser(offer.agentId, 'agent', {
      title: offer.backToBack ? 'Your next errand' : 'New errand for you',
      body: `${category?.name ?? 'Errand'} · ${formatNaira(errand.feeKobo)} · ${minutes} min away${offer.backToBack ? ', after the one you are on' : ''}. Answer within ${Math.round((offer.expiresAt.getTime() - offer.offeredAt.getTime()) / 1000)} seconds.`,
      data: {
        type: 'errand.offer',
        errandId: errand.id,
        offerId: offer.id,
        expiresAt: offer.expiresAt.toISOString(),
      },
      ring: true,
      tag: offer.id,
    });
    this.realtime.toUser(offer.agentId, 'agent', 'offer.new', {
      offerId: offer.id,
      errandId: errand.id,
      expiresAt: offer.expiresAt,
    });
  }

  /** The agent said no: the offer goes to the next agent. */
  async decline(agentId: string, offerId: string) {
    const [offer] = await this.db
      .update(errandOffers)
      .set({ status: 'declined', answeredAt: new Date() })
      .where(and(eq(errandOffers.id, offerId), eq(errandOffers.agentId, agentId), eq(errandOffers.status, 'open')))
      .returning({
        errandId: errandOffers.errandId,
        counts: errandOffers.counts,
        countryCode: errandOffers.countryCode,
      });
    if (!offer) throw notFound('offer_not_found', 'This offer has ended');
    if (offer.counts) {
      await this.pauseIfLow(agentId, offer.countryCode).catch((error: Error) =>
        this.logger.warn(`Checking acceptance for ${agentId} failed: ${error.message}`),
      );
    }
    await this.dispatch(offer.errandId);
    return { status: 'declined' as const };
  }

  /** The offer's time is up: it goes to the next agent. */
  async expire(offerId: string) {
    const [offer] = await this.db
      .update(errandOffers)
      .set({ status: 'expired' })
      .where(and(eq(errandOffers.id, offerId), eq(errandOffers.status, 'open')))
      .returning();
    if (offer) await this.ended(offer, { offerAgain: true });
  }

  /**
   * After an offer ran out: the agent's app is told, an agent who let several run out in a row since going
   * online is taken offline, and the errand is offered to the next agent unless that is under way already.
   */
  private async ended(offer: OfferRow, { offerAgain }: { offerAgain: boolean }) {
    this.realtime.toUser(offer.agentId, 'agent', 'offer.gone', { offerId: offer.id, errandId: offer.errandId });
    await this.offlineIfMissing(offer.agentId, offer.countryCode).catch((error: Error) =>
      this.logger.warn(`Checking missed offers failed: ${error.message}`),
    );
    if (offer.counts) {
      await this.pauseIfLow(offer.agentId, offer.countryCode).catch((error: Error) =>
        this.logger.warn(`Checking acceptance for ${offer.agentId} failed: ${error.message}`),
      );
    }
    if (offerAgain) await this.dispatch(offer.errandId);
  }

  private async offlineIfMissing(agentId: string, countryCode: string) {
    const rules = (await this.countries.currentSettings(countryCode)).settings.matching;
    const n = rules.missedOffersOffline;
    if (n <= 0) return;
    const [presence] = await this.db
      .select({ online: agentPresence.online, since: agentPresence.onlineSince })
      .from(agentPresence)
      .where(eq(agentPresence.userId, agentId));
    if (!presence?.online) return;
    const recent = await this.db
      .select({ status: errandOffers.status })
      .from(errandOffers)
      .where(
        and(
          eq(errandOffers.agentId, agentId),
          gte(errandOffers.offeredAt, presence.since ?? new Date(0)),
          // Not those made back to back (M10): the agent is out on an errand, likely driving, when one rings.
          eq(errandOffers.backToBack, false),
        ),
      )
      .orderBy(desc(errandOffers.offeredAt))
      .limit(n);
    if (recent.length < n || recent.some((o) => o.status !== 'expired')) return;
    // Kept offline until they go online again themselves, not by their app still reporting online.
    const [off] = await this.db
      .update(agentPresence)
      .set({ online: false, onlineSince: null, offlineReason: 'missed_offers', updatedAt: new Date() })
      .where(and(eq(agentPresence.userId, agentId), eq(agentPresence.online, true)))
      .returning({ userId: agentPresence.userId });
    if (!off) return;
    await this.presence.forgetIfIdle(agentId);
    await this.locations.remove(agentId, countryCode).catch(() => undefined);
    this.realtime.toUser(agentId, 'agent', 'presence.updated', { online: false, reason: 'missed_offers' });
    await this.push.notifyUser(agentId, 'agent', {
      title: "You're offline",
      body: `You missed ${n} offers in a row, so Jiffo took you offline. Go online again when you're ready.`,
      data: { type: 'presence.offline', reason: 'missed_offers' },
    });
  }

  /** No longer open to everyone, at its new fee: those told of it at the old one hear so, once. */
  private async reopened(errand: ErrandRow) {
    const was = errand.broadcastFeeKobo!;
    const [cleared] = await this.db
      .update(errands)
      .set({ broadcastFeeKobo: null })
      .where(and(eq(errands.id, errand.id), eq(errands.broadcastFeeKobo, was)))
      .returning({ id: errands.id });
    if (!cleared) return;
    this.realtime.boardChanged(errand.id, 'removed');
    await this.tellGone(errand.id, was, null, 'offered');
  }

  /**
   * Agents told of an errand open to everyone at a fee (M8) hear it's gone from the board: taken, ended
   * (cancelled or expired), or offered one at a time again (a raised fee). Not the agent who took it.
   */
  private async tellGone(
    errandId: string,
    feeKobo: number,
    takenBy: string | null,
    why: 'taken' | 'ended' | 'offered',
  ) {
    const told = await this.db
      .select({ agentId: errandBroadcasts.agentId })
      .from(errandBroadcasts)
      .where(and(eq(errandBroadcasts.errandId, errandId), eq(errandBroadcasts.feeKobo, feeKobo)));
    for (const t of told) {
      if (t.agentId === takenBy) continue;
      this.realtime.toUser(t.agentId, 'agent', 'errand.gone', { errandId, taken: why === 'taken', why });
    }
  }

  /**
   * The errand left waiting another way (cancelled, expired, taken): its open offer is withdrawn, and the agents
   * told of it while it was open to everyone (M8) are told it was taken, or has gone, all but the one who took it.
   */
  private async withdraw(errand: ErrandRow) {
    const gone = await this.db
      .update(errandOffers)
      .set({ status: 'withdrawn', answeredAt: new Date() })
      .where(and(eq(errandOffers.errandId, errand.id), eq(errandOffers.status, 'open')))
      .returning({ id: errandOffers.id, agentId: errandOffers.agentId });
    for (const g of gone)
      this.realtime.toUser(g.agentId, 'agent', 'offer.gone', { offerId: g.id, errandId: errand.id });
    if (errand.broadcastFeeKobo === null) return;
    await this.tellGone(errand.id, errand.broadcastFeeKobo, errand.agentId, errand.agentId ? 'taken' : 'ended');
  }

  /**
   * The agent's open offer, as the offer screen shows it (docs/matching.md, M6): what, for how much, the
   * pickup and drop-off areas and how far each is, and who the customer is (first name and initial, verified,
   * rating, errands done). Never an address, as for any agent before accepting. null with none. With what they'd
   * earn, and the seconds left by the server's clock, which the app counts down from (a phone's clock can be off).
   */
  async current(agentId: string) {
    const [offer] = await this.db
      .select({ offer: errandOffers, errand: errands })
      .from(errandOffers)
      .innerJoin(errands, eq(errands.id, errandOffers.errandId))
      .where(
        and(eq(errandOffers.agentId, agentId), eq(errandOffers.status, 'open'), gt(errandOffers.expiresAt, new Date())),
      );
    if (!offer) return null;
    const { errand } = offer;
    const [stops, [customer], [verified], [rated], [done], earns] = await Promise.all([
      this.db.select().from(errandStops).where(eq(errandStops.errandId, errand.id)).orderBy(asc(errandStops.seq)),
      this.db
        .select({ firstName: users.firstName, lastName: users.lastName })
        .from(users)
        .where(eq(users.id, errand.customerId)),
      this.db
        .select({ status: customerVerifications.status })
        .from(customerVerifications)
        .where(eq(customerVerifications.userId, errand.customerId)),
      this.db
        .select({ average: sql<number | null>`avg(${errandRatings.stars})::float`, n: sql<number>`count(*)::int` })
        .from(errandRatings)
        .where(and(eq(errandRatings.rateeId, errand.customerId), eq(errandRatings.raterRole, 'agent'))),
      this.db
        .select({ n: sql<number>`count(*)::int` })
        .from(errands)
        .where(and(eq(errands.customerId, errand.customerId), eq(errands.status, 'completed'))),
      this.agents.tier(agentId).then((tier) => agentEarnsKobo(this.countries, errand, tier)),
    ]);
    const pickup = stops[0]!;
    const dropoff = stops[stops.length - 1]!;
    // To the pickup from where the agent was when offered, then along the stops to the drop-off.
    let route = 0;
    for (let i = 1; i < stops.length; i++) route += haversineMeters(stops[i - 1]!, stops[i]!);
    const km = (m: number) => Math.round(m / 100) / 10;
    return {
      id: offer.offer.id,
      expiresAt: offer.offer.expiresAt,
      // Whether declining it lowers their acceptance rate (M9): the offer screen marks the ones that don't.
      counts: offer.offer.counts,
      // Back to back (M10): it waits behind the errand they hold, and starts once that one is done.
      backToBack: offer.offer.backToBack,
      secondsLeft: Math.max(0, Math.ceil((offer.offer.expiresAt.getTime() - Date.now()) / 1000)),
      windowSeconds: Math.round((offer.offer.expiresAt.getTime() - offer.offer.offeredAt.getTime()) / 1000),
      agentEarnsKobo: earns,
      errand: {
        id: errand.id,
        categoryKey: errand.categoryKey,
        feeKobo: errand.feeKobo,
        buy: errand.buy,
        urgent: errand.urgent,
        stopCount: stops.length,
        scheduledFor: errand.scheduledFor,
      },
      pickup: { area: stopArea(pickup).address, km: km(offer.offer.straightMeters) },
      dropoff: { area: stopArea(dropoff).address, km: km(offer.offer.straightMeters + route) },
      customer: {
        firstName: customer?.firstName ?? null,
        lastInitial: customer?.lastName ? customer.lastName.trim().charAt(0).toUpperCase() : null,
        verified: verified?.status === 'verified',
        rating: rated && rated.n ? Math.round(rated.average! * 10) / 10 : null,
        completedErrands: done?.n ?? 0,
      },
    };
  }
}
