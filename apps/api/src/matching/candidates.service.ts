import { Inject, Injectable, Logger } from '@nestjs/common';
import { matchRefusal, type CountrySettings } from '@jiffo/shared';
import { and, eq, sql } from 'drizzle-orm';
import type { LatLng } from '../adapters/maps';
import { ApiError } from '../common/errors';
import { CountriesService } from '../countries/countries.service';
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
}

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
    private readonly countries: CountriesService,
    private readonly locations: AgentLocations,
    private readonly eligibility: EligibilityService,
    private readonly travelTimes: TravelTimesService,
  ) {}

  /**
   * `skip`: agents left out before the shortlist is drawn up (offers, M6: those who said no to the errand at
   * this fee, and those holding another offer), so they never take the places of agents who could be asked.
   * `radiusKm`: how far from the pickup to look (a search step, M8); the board's reach when left out.
   */
  async forErrand(errandId: string, skip: ReadonlySet<string> = new Set(), radiusKm?: number): Promise<Candidate[]> {
    const found = await this.waiting(errandId);
    if (!found) return [];
    const { errand, pickup, rules } = found;
    const shortlist = await this.checkedNear(
      errand,
      pickup,
      rules,
      skip,
      radiusKm ?? rules.boardRadiusKm,
      rules.shortlistSize,
    );
    const travel = await this.travelTimes.toPickup(shortlist, pickup, rules);
    return shortlist
      .map((c) => ({ agentId: c.agentId, straightMeters: c.straightMeters, travel: travel.get(c.agentId)! }))
      .sort((a, b) => a.travel.durationSeconds - b.travel.durationSeconds || a.straightMeters - b.straightMeters);
  }

  /**
   * Every agent within `radiusKm` of the pickup who may take the errand now, nearest first, up to `max`: those an
   * urgent errand open to everyone is told of (M8). No travel times: no one is ranked.
   */
  async everyoneWithin(errandId: string, skip: ReadonlySet<string>, radiusKm: number, max = 200) {
    const found = await this.waiting(errandId);
    if (!found) return [];
    const { errand, pickup, rules } = found;
    const checked = await this.checkedNear(errand, pickup, rules, skip, radiusKm, max);
    return checked.map((c) => ({ agentId: c.agentId, straightMeters: c.straightMeters }));
  }

  /** The errand if it still waits, with its pickup and its country's Matching rules. */
  private async waiting(errandId: string) {
    const [row] = await this.db
      .select({ errand: errands, lat: errandStops.lat, lng: errandStops.lng })
      .from(errands)
      .innerJoin(errandStops, and(eq(errandStops.errandId, errands.id), eq(errandStops.seq, 0)))
      .where(eq(errands.id, errandId));
    if (!row || row.errand.status !== 'requested') return null;
    const rules = (await this.countries.currentSettings(row.errand.countryCode)).settings.matching;
    return { errand: row.errand, pickup: { lat: row.lat, lng: row.lng }, rules };
  }

  /** The nearest agents within the radius who pass the check, a few at a time, until there are `want`. */
  private async checkedNear(
    errand: ErrandRow,
    pickup: LatLng,
    rules: CountrySettings['matching'],
    skip: ReadonlySet<string>,
    radiusKm: number,
    want: number,
  ) {
    // More than wanted: some of the nearest are left out, and some won't pass the check.
    const near = (await this.nearest(errand.countryCode, pickup, rules, want * 3 + skip.size, radiusKm)).filter(
      (n) => !skip.has(n.agentId),
    );
    const out: Array<Omit<Candidate, 'travel'> & LatLng> = [];
    for (let i = 0; i < near.length && out.length < want; i += CHECK_AT_ONCE) {
      const checked = await Promise.all(near.slice(i, i + CHECK_AT_ONCE).map((n) => this.check(n, errand, rules)));
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

  /** The agent, if they may get this errand now, by the same check as the board and accepting. */
  private async check(near: NearAgent, errand: ErrandRow, rules: CountrySettings['matching']) {
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
    if (matchRefusal(me, this.eligibility.matchErrand(errand, pickupMeters, near.agentId, facts), rules)) return null;
    return { agentId: near.agentId, straightMeters: Math.round(pickupMeters), lat: me.lat, lng: me.lng };
  }
}
