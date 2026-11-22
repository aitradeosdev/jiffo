import { Inject, Injectable, Logger } from '@nestjs/common';
import { atTheEnd, backToBackFrom, haversineMeters, matchRefusal, type CountrySettings } from '@jiffo/shared';
import { and, eq, sql } from 'drizzle-orm';
import type { LatLng } from '../adapters/maps';
import { ApiError } from '../common/errors';
import { MatchingPlacesService } from '../countries/matching-places.service';
import { DB, type Db } from '../db/database.module';
import { errandStops, errands } from '../db/schema';
import { AgentLocations, type NearAgent } from './agent-locations';
import { EligibilityService } from './eligibility.service';
import { TravelTimesService, type Travel } from './travel-times';

/** Someone who could be offered an errand now, and how soon they could reach its pickup. */
export interface Candidate {
  agentId: string;
  /** From their position, as the database has it, to the pickup in a straight line. */
  straightMeters: number;
  travel: Travel;
  /**
   * Near the end of another errand (M10): offered this one back to back, to wait behind it, with the travel time
   * the rest of that one and then the drive from its drop-off.
   */
  backToBack: boolean;
}

/** An agent near the end of an errand, as checked: that errand's drop-off, and whether it is at its end already. */
type Following = { dropoff: LatLng; atTheEnd: boolean };

type ErrandRow = typeof errands.$inferSelect;

/** Agents are checked a few at a time, nearest first, until the shortlist is full. */
const CHECK_AT_ONCE = 10;

/**
 * Who could be offered a waiting errand now (docs/matching.md, M2 and M3): the agents nearest its pickup in a
 * straight line, from their live positions, within the Matching reach. Each is checked again against the
 * database (EligibilityService, as accepting does), so a live position alone gets no one an errand, and the
 * shortlist has its road travel times from the maps provider, quickest first.
 */
@Injectable()
export class CandidatesService {
  private readonly logger = new Logger('Candidates');

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly places: MatchingPlacesService,
    private readonly locations: AgentLocations,
    private readonly eligibility: EligibilityService,
    private readonly travelTimes: TravelTimesService,
  ) {}

  /**
   * `skip`: agents left out before the shortlist is drawn up (offers, M6: those who said no to the errand at
   * this fee, and those holding another offer), so they never take the places of agents who could be asked.
   * `radiusKm`: how far from the pickup to look (a search step, M8); the board's reach when left out.
   */
  async forErrand(
    errandId: string,
    skip: ReadonlySet<string> = new Set(),
    radiusKm?: number,
    known?: CountrySettings['matching'],
  ): Promise<Candidate[]> {
    const found = await this.waiting(errandId, known);
    if (!found) return [];
    const { errand, pickup, rules } = found;
    const shortlist = await this.checkedNear(
      errand,
      pickup,
      rules,
      skip,
      radiusKm ?? rules.boardRadiusKm,
      rules.shortlistSize,
      // Offered one at a time, an urgent errand can go back to back (M10); never one open to everyone.
      errand.urgent,
    );
    const travel = await this.travelTimes.toPickup(
      shortlist.filter((c) => !c.following),
      pickup,
      rules,
    );
    return shortlist
      .map((c) => ({
        agentId: c.agentId,
        straightMeters: c.straightMeters,
        travel: c.following ? this.backToBackTravel(c, c.following, pickup, rules) : travel.get(c.agentId)!,
        backToBack: !!c.following,
      }))
      .sort((a, b) => a.travel.durationSeconds - b.travel.durationSeconds || a.straightMeters - b.straightMeters);
  }

  /**
   * The agents within `radiusKm` of the pickup who may take the errand now, nearest first, up to `max` at a time:
   * those an urgent errand open to everyone is told of (M8), the rest on the next look, every few seconds. No
   * travel times: no one is ranked.
   */
  async everyoneWithin(
    errandId: string,
    skip: ReadonlySet<string>,
    radiusKm: number,
    max = 50,
    known?: CountrySettings['matching'],
  ) {
    const found = await this.waiting(errandId, known);
    if (!found) return [];
    const { errand, pickup, rules } = found;
    const checked = await this.checkedNear(errand, pickup, rules, skip, radiusKm, max);
    return checked.map((c) => ({ agentId: c.agentId, straightMeters: c.straightMeters }));
  }

  /**
   * The errand if it still waits, with its pickup and the Matching rules where it is (M14): `rules` when the caller
   * has them already.
   */
  private async waiting(errandId: string, known?: CountrySettings['matching']) {
    const [row] = await this.db
      .select({ errand: errands, lat: errandStops.lat, lng: errandStops.lng })
      .from(errands)
      .innerJoin(errandStops, and(eq(errandStops.errandId, errands.id), eq(errandStops.seq, 0)))
      .where(eq(errands.id, errandId));
    if (!row || row.errand.status !== 'requested') return null;
    const rules = known ?? (await this.places.rulesFor(row.errand));
    return { errand: row.errand, pickup: { lat: row.lat, lng: row.lng }, rules };
  }

  /**
   * How soon an agent near the end of an errand reaches the next pickup (M10): the rest of the way to that errand's
   * drop-off, none once it is delivered, then the drive from there. Estimated: neither leg is a route the maps
   * provider is asked for.
   */
  private backToBackTravel(
    agent: LatLng,
    following: Following,
    pickup: LatLng,
    rules: CountrySettings['matching'],
  ): Travel {
    const legs = [
      following.atTheEnd ? null : TravelTimesService.estimate(haversineMeters(agent, following.dropoff), rules),
      TravelTimesService.estimate(haversineMeters(following.dropoff, pickup), rules),
    ].filter((l): l is Travel => l !== null);
    return {
      distanceMeters: legs.reduce((n, l) => n + l.distanceMeters, 0),
      durationSeconds: legs.reduce((n, l) => n + l.durationSeconds, 0),
      estimated: true,
    };
  }

  /** The nearest agents within the radius who pass the check, a few at a time, until there are `want`. */
  private async checkedNear(
    errand: ErrandRow,
    pickup: LatLng,
    rules: CountrySettings['matching'],
    skip: ReadonlySet<string>,
    radiusKm: number,
    want: number,
    backToBack = false,
  ) {
    // More than wanted: some of the nearest are left out, and some won't pass the check.
    const near = (await this.nearest(errand.countryCode, pickup, rules, want * 3 + skip.size, radiusKm)).filter(
      (n) => !skip.has(n.agentId),
    );
    const out: Array<Omit<Candidate, 'travel' | 'backToBack'> & LatLng & { following: Following | null }> = [];
    for (let i = 0; i < near.length && out.length < want; i += CHECK_AT_ONCE) {
      const checked = await Promise.all(
        near.slice(i, i + CHECK_AT_ONCE).map((n) => this.check(n, errand, pickup, rules, backToBack)),
      );
      for (const c of checked) if (c && out.length < want) out.push(c);
    }
    return out;
  }

  /**
   * The nearest live positions, from Redis, loaded from the database first if Redis lost them (restarted or
   * flushed); the database's when Redis can't say (logged).
   */
  private async nearest(
    countryCode: string,
    pickup: LatLng,
    rules: CountrySettings['matching'],
    count: number,
    radiusKm: number,
  ): Promise<NearAgent[]> {
    try {
      if (!(await this.locations.loaded(countryCode))) {
        await this.locations.load(countryCode, await this.livePositions(countryCode, rules.locationFreshMinutes));
      }
      return await this.locations.near(countryCode, pickup, radiusKm, count, rules.locationFreshMinutes);
    } catch (error) {
      this.logger.warn(`Live positions unavailable, reading the database: ${(error as Error).message}`);
      return this.nearestInDatabase(countryCode, pickup, rules, count, radiusKm);
    }
  }

  /** Every online agent's real position the database has from the last few minutes, to load into Redis. */
  private async livePositions(countryCode: string, freshMinutes: number) {
    const { rows } = await this.db.execute<{ agentId: string; lat: number; lng: number; at: Date | string }>(sql`
      select user_id as "agentId", lat, lng, located_at as at
      from agent_presence
      where country_code = ${countryCode} and online and not mocked and lat is not null and lng is not null
        and located_at > now() - make_interval(mins => ${freshMinutes})`);
    return rows.map((r) => ({ agentId: r.agentId, lat: r.lat, lng: r.lng, seenAt: new Date(r.at) }));
  }

  private async nearestInDatabase(
    countryCode: string,
    pickup: LatLng,
    rules: CountrySettings['matching'],
    count: number,
    radiusKm: number,
  ): Promise<NearAgent[]> {
    {
      const here = sql`ST_SetSRID(ST_MakePoint(${pickup.lng}, ${pickup.lat}), 4326)::geography`;
      const { rows } = await this.db.execute<{
        agentId: string;
        lat: number;
        lng: number;
        meters: number | string;
      }>(sql`
        select user_id as "agentId", lat, lng, ST_Distance(location, ${here}) as meters
        from agent_presence
        where country_code = ${countryCode} and online and not mocked
          and located_at > now() - make_interval(mins => ${rules.locationFreshMinutes})
          and ST_DWithin(location, ${here}, ${radiusKm * 1000})
        order by meters limit ${count}`);
      return rows.map((r) => ({ agentId: r.agentId, lat: r.lat, lng: r.lng, meters: Math.round(Number(r.meters)) }));
    }
  }

  /**
   * The agent, if they may get this errand now, by the same check as the board and accepting. With `backToBack`,
   * also one busy with another errand who is near its end, and the pickup near its drop-off (M10).
   */
  private async check(
    near: NearAgent,
    errand: ErrandRow,
    pickup: LatLng,
    rules: CountrySettings['matching'],
    backToBack: boolean,
  ) {
    let me;
    try {
      me = await this.eligibility.agent(near.agentId, rules);
    } catch (error) {
      if (error instanceof ApiError) return null;
      throw error;
    }
    // Measured as accepting measures it, from the database's position.
    const pickupMeters = await this.eligibility.pickupMeters(errand.id, me);
    const facts = await this.eligibility.facts(near.agentId, [errand]);
    const asked = this.eligibility.matchErrand(errand, pickupMeters, near.agentId, facts);
    const refused = matchRefusal(me, asked, rules);
    let following: Following | null = null;
    if (refused && backToBack && (refused === 'finish_urgent' || refused === 'busy')) {
      const current = backToBackFrom(me, pickup, rules);
      if (!current?.dropoff || matchRefusal(me, asked, rules, { backToBack: true })) return null;
      following = { dropoff: current.dropoff, atTheEnd: atTheEnd(current) };
    } else if (refused) {
      return null;
    }
    return { agentId: near.agentId, straightMeters: Math.round(pickupMeters), lat: me.lat, lng: me.lng, following };
  }
}
