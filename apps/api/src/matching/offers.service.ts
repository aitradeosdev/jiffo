import { Inject, Injectable, Logger } from '@nestjs/common';
import { formatNaira } from '@jiffo/shared';
import { and, asc, desc, eq, gt, gte, inArray, sql } from 'drizzle-orm';
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
    try {
      if (errand.status !== 'requested') await this.withdraw(errand.id);
      else if (errand.urgent) await this.dispatch(errand.id);
    } catch (error) {
      this.logger.warn(`Offering errand ${errand.id} failed: ${(error as Error).message}`);
    }
  }

  /** The open offer for an errand, if any. */
  private async openFor(errandId: string) {
    const [open] = await this.db
      .select({ id: errandOffers.id })
      .from(errandOffers)
      .where(and(eq(errandOffers.errandId, errandId), eq(errandOffers.status, 'open')));
    return open ?? null;
  }

  /**
   * Offers a waiting urgent errand to the best-ranked agent who may take it now, hasn't said no to it at this
   * fee and holds no other offer, unless someone holds an offer for it already. With no one, looks again later.
   */
  async dispatch(errandId: string): Promise<void> {
    const [errand] = await this.db.select().from(errands).where(eq(errands.id, errandId));
    if (!errand || errand.status !== 'requested' || !errand.urgent) return;
    if (await this.openFor(errandId)) return;
    const rules = (await this.countries.currentSettings(errand.countryCode)).settings.matching;
    const [ranked, passed] = await Promise.all([
      this.ranking.ranked(errandId),
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
    ]);
    const said = new Set(passed.map((p) => p.agentId));
    for (const [i, r] of ranked.entries()) {
      if (said.has(r.agentId)) continue;
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
      // The agent holds another offer, or someone else offered this errand first.
      if (!offer) {
        if (await this.openFor(errandId)) return;
        continue;
      }
      await this.timers.schedule(
        { errandId, event: 'offer_expire', status: 'requested', version: errand.version, offerId: offer.id },
        rules.offerSeconds * 1000,
      );
      await this.tell(offer, errand, r);
      return;
    }
    // No one can take it now: look again soon, while it waits, with one look at a time waiting per errand.
    const first = await this.redis.client
      .set(`offers:retry:${errandId}`, '1', 'EX', rules.dispatchRetrySeconds, 'NX')
      .catch(() => 'OK');
    if (first !== 'OK') return;
    await this.timers.schedule(
      { errandId, event: 'offer_dispatch', status: 'requested', version: errand.version, key: String(Date.now()) },
      rules.dispatchRetrySeconds * 1000,
    );
  }

  /** The look again is due: the next one may be scheduled. */
  async retry(errandId: string) {
    await this.redis.client.del(`offers:retry:${errandId}`).catch(() => undefined);
    await this.dispatch(errandId);
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

  /**
   * The offer's time is up: it goes to the next agent. An agent who lets several run out in a row since going
   * online is taken offline, and told.
   */
  async expire(offerId: string) {
    const [offer] = await this.db
      .update(errandOffers)
      .set({ status: 'expired' })
      .where(and(eq(errandOffers.id, offerId), eq(errandOffers.status, 'open')))
      .returning();
    if (!offer) return;
    this.realtime.toUser(offer.agentId, 'agent', 'offer.gone', { offerId, errandId: offer.errandId });
    await this.offlineIfMissing(offer.agentId, offer.countryCode).catch((error: Error) =>
      this.logger.warn(`Checking missed offers failed: ${error.message}`),
    );
    await this.dispatch(offer.errandId);
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
    const [off] = await this.db
      .update(agentPresence)
      .set({ online: false, onlineSince: null, updatedAt: new Date() })
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
