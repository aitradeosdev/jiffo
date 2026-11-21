import { Inject, Injectable, Logger } from '@nestjs/common';
import { DEFAULT_MATCHING_SETTINGS, formatNaira } from '@jiffo/shared';
import { and, asc, desc, eq, gt, gte, inArray, lt, lte, sql } from 'drizzle-orm';
import { haversineMeters } from '../adapters/maps';
import { PresenceService } from '../agents/presence.service';
import { notFound } from '../common/errors';
import { CountriesService } from '../countries/countries.service';
import { DB, type Db } from '../db/database.module';
import {
  agentPresence,
  customerVerifications,
  errandOffers,
  errandRatings,
  errandStops,
  errands,
  users,
} from '../db/schema';
import { stopArea } from '../errands/errand-view';
import { PushService } from '../push/push.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { ERRAND_TIMERS, type ErrandTimers } from '../timers/errand-timers';
import { AgentLocations } from './agent-locations';
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
    private readonly ranking: RankingService,
    private readonly push: PushService,
    private readonly realtime: RealtimeGateway,
    private readonly presence: PresenceService,
    private readonly locations: AgentLocations,
    private readonly redis: MatchingRedis,
  ) {}

  /**
   * After an errand changed: while an urgent one waits, it is offered (or offered again, its fee raised or its
   * agent gone); once it has left waiting, an offer still open for it is withdrawn. Never fails the change.
   */
  async errandChanged(errand: ErrandRow) {
    if (errand.status === 'requested') {
      if (errand.urgent) await this.dispatch(errand.id);
      return;
    }
    await this.withdraw(errand.id).catch((error: Error) =>
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
    const rules = (await this.countries.currentSettings(errand.countryCode)).settings.matching;
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
    // Left out before the shortlist is drawn up, so they never take the places of agents who could be asked:
    // who said no to it at this fee, and who holds another offer (one at a time, kept by the database too).
    const [passed, holding] = await Promise.all([
      this.db
        .select({ agentId: errandOffers.agentId })
        .from(errandOffers)
        .where(
          and(
            eq(errandOffers.errandId, errandId),
            inArray(errandOffers.status, ['declined', 'expired']),
            eq(errandOffers.feeKobo, errand.feeKobo),
          ),
        ),
      this.db
        .select({ agentId: errandOffers.agentId })
        .from(errandOffers)
        .where(and(eq(errandOffers.countryCode, errand.countryCode), eq(errandOffers.status, 'open'))),
    ]);
    const skip = new Set([...passed, ...holding].map((p) => p.agentId));
    const ranked = await this.ranking.ranked(errandId, skip);
    for (const [i, r] of ranked.entries()) {
      const now = new Date();
      const offer = await this.db.transaction(async (tx) => {
        // The errand as it is now, locked as accepting locks it: still waiting, at the fee ranked for.
        const [still] = await tx
          .select({ status: errands.status, feeKobo: errands.feeKobo })
          .from(errands)
          .where(eq(errands.id, errandId))
          .for('update');
        if (still?.status !== 'requested' || still.feeKobo !== errand.feeKobo) return 'stop' as const;
        // The database keeps one open offer per errand and per agent: nothing is written if either holds one.
        const [row] = await tx
          .insert(errandOffers)
          .values({
            errandId,
            agentId: r.agentId,
            countryCode: errand.countryCode,
            feeKobo: errand.feeKobo,
            rank: i + 1,
            score: r.score,
            parts: { ...r.parts },
            travelSeconds: r.travel.durationSeconds,
            travelEstimated: r.travel.estimated,
            straightMeters: r.straightMeters,
            offeredAt: now,
            expiresAt: new Date(now.getTime() + rules.offerSeconds * 1000),
          })
          .onConflictDoNothing()
          .returning();
        return row ?? null;
      });
      if (offer === 'stop') return;
      // The agent was offered another errand meanwhile, or someone else offered this errand first.
      if (!offer) {
        if (await this.openFor(errandId)) return;
        continue;
      }
      await this.timers.schedule(
        { errandId, event: 'offer_expire', status: 'requested', version: errand.version, offerId: offer.id },
        rules.offerSeconds * 1000,
      );
      // The offer stands if the push fails: the agent's app also shows it (GET /v1/agent/offers/current).
      await this.tell(offer, errand, r).catch((error: Error) =>
        this.logger.warn(`Telling agent ${offer.agentId} of an offer failed: ${error.message}`),
      );
      return;
    }
    // No one can take it now: look again soon.
    await this.later(errandId, errand.version, rules.dispatchRetrySeconds);
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
      .select({ id: errands.id })
      .from(errands)
      .where(
        and(
          eq(errands.status, 'requested'),
          eq(errands.urgent, true),
          sql`not exists (select 1 from ${errandOffers} o where o.errand_id = ${errands.id} and o.status = 'open')`,
        ),
      );
    for (const w of waiting) {
      const looking = await this.redis.client.exists(retryKey(w.id)).catch(() => 0);
      if (!looking) await this.dispatch(w.id);
    }
    return lost.length;
  }

  /** Rings the agent's phone, and tells their open app. */
  private async tell(offer: OfferRow, errand: ErrandRow, ranked: Ranked) {
    const category = await this.countries.activeCategory(errand.countryCode, errand.categoryKey);
    const minutes = Math.max(1, Math.round(ranked.travel.durationSeconds / 60));
    await this.push.notifyUser(offer.agentId, 'agent', {
      title: 'New errand for you',
      body: `${category?.name ?? 'Errand'} · ${formatNaira(errand.feeKobo)} · ${minutes} min away. Answer within ${Math.round((offer.expiresAt.getTime() - offer.offeredAt.getTime()) / 1000)} seconds.`,
      data: {
        type: 'errand.offer',
        errandId: errand.id,
        offerId: offer.id,
        expiresAt: offer.expiresAt.toISOString(),
      },
      ring: true,
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
      .returning({ errandId: errandOffers.errandId });
    if (!offer) throw notFound('offer_not_found', 'This offer has ended');
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
      .where(and(eq(errandOffers.agentId, agentId), gte(errandOffers.offeredAt, presence.since ?? new Date(0))))
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

  /** The errand left waiting another way (cancelled, expired, taken): its open offer is withdrawn. */
  private async withdraw(errandId: string) {
    const gone = await this.db
      .update(errandOffers)
      .set({ status: 'withdrawn', answeredAt: new Date() })
      .where(and(eq(errandOffers.errandId, errandId), eq(errandOffers.status, 'open')))
      .returning({ id: errandOffers.id, agentId: errandOffers.agentId });
    for (const g of gone) this.realtime.toUser(g.agentId, 'agent', 'offer.gone', { offerId: g.id, errandId });
  }

  /**
   * The agent's open offer, as the offer screen shows it (docs/matching.md, M6): what, for how much, the
   * pickup and drop-off areas and how far each is, and who the customer is (first name and initial, verified,
   * rating, errands done). Never an address, as for any agent before accepting. null with none.
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
    const [stops, [customer], [verified], [rated], [done]] = await Promise.all([
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
