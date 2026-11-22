import { Inject, Injectable } from '@nestjs/common';
import {
  AGENT_OUT_STATES,
  averageReliability,
  byRank,
  rankScore,
  type AgentTier,
  type CountrySettings,
  type RankInputs,
  type RankParts,
  type StateAverages,
} from '@jiffo/shared';
import { eq, sql } from 'drizzle-orm';
import { CountriesService } from '../countries/countries.service';
import { MatchingPlacesService } from '../countries/matching-places.service';
import { DB, type Db } from '../db/database.module';
import { agentPresence, errands } from '../db/schema';
import { completionRate, LEFT_EVENTS, RECENT, recentAccepts } from './completion';
import { CandidatesService, type Candidate } from './candidates.service';
import { MatchingRedis } from './matching-redis';

/** A candidate with their score for the errand, and its parts (kept with each offer, M15). */
export interface Ranked extends Candidate {
  score: number;
  parts: RankParts;
  /** When they went online: an offer in their first minutes doesn't count toward their acceptance rate (M9). */
  onlineSince: Date | null;
}

/** Errands of their own that count: their last 100 accepted, and their last 100 ratings (M4). */
/** How long a state's averages are used before being worked out again. */
const AVERAGES_SECONDS = 10 * 60;
/** A state with no history yet: every agent reliable, rated four and a half stars. */
const NO_HISTORY: StateAverages = { reliability: 1, ratingStars: 4.5 };

type History = Omit<RankInputs, 'travelSeconds'> & { countedOffers: number; onlineSince: Date | null };

/**
 * Who is offered an errand first (docs/matching.md, M4): the candidates (CandidatesService), each scored by
 * rankScore in @jiffo/shared from their travel time and their own history, highest first.
 */
@Injectable()
export class RankingService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly countries: CountriesService,
    private readonly places: MatchingPlacesService,
    private readonly candidates: CandidatesService,
    private readonly redis: MatchingRedis,
  ) {}

  /**
   * `skip` and `radiusKm`: who is left out, and how far to look (CandidatesService.forErrand). `rules`: the
   * Matching rules where the errand is (M14), when the caller has them already.
   */
  async ranked(
    errandId: string,
    skip?: ReadonlySet<string>,
    radiusKm?: number,
    known?: CountrySettings['matching'],
  ): Promise<Ranked[]> {
    const [errand] = await this.db
      .select({ countryCode: errands.countryCode, stateCode: errands.stateCode, areaId: errands.areaId })
      .from(errands)
      .where(eq(errands.id, errandId));
    if (!errand) return [];
    const rules = known ?? (await this.places.rulesFor(errand));
    const found = await this.candidates.forErrand(errandId, skip, radiusKm, rules);
    if (!found.length) return [];
    const [history, average] = await Promise.all([
      this.history(
        found.map((c) => c.agentId),
        rules,
      ),
      this.stateAverages(errand.countryCode, errand.stateCode),
    ]);
    return found
      .map((c) => {
        const { countedOffers: _, onlineSince, ...mine } = history.get(c.agentId)!;
        const parts = rankScore({ travelSeconds: c.travel.durationSeconds, ...mine }, rules, average);
        return { ...c, score: parts.total, parts, onlineSince, travelSeconds: c.travel.durationSeconds };
      })
      .sort(byRank)
      .map(({ travelSeconds: _, ...r }) => r);
  }

  /**
   * How the agent stands (M9), as the agent app shows it beside their rating: their acceptance rate over their last
   * counted offers, completion rate, errands left this week, rating, errands done, and any pause on their offers.
   */
  async standing(agentId: string, countryCode: string) {
    const rules = (await this.countries.currentSettings(countryCode)).settings.matching;
    const [mine, [presence]] = await Promise.all([
      this.history([agentId], rules),
      this.db
        .select({ until: agentPresence.offersPausedUntil })
        .from(agentPresence)
        .where(eq(agentPresence.userId, agentId)),
    ]);
    const h = mine.get(agentId)!;
    const until = presence?.until && presence.until.getTime() > Date.now() ? presence.until : null;
    return {
      acceptanceRate: h.acceptanceRate,
      countedOffers: h.countedOffers,
      completionRate: h.completionRate,
      cancellations7d: h.cancellations7d,
      ratingStars: h.ratingStars,
      completedErrands: h.completedErrands,
      offersPausedUntil: until,
    };
  }

  /**
   * How several agents stand, for the matching dashboard (M15): their acceptance rate over their last counted
   * offers, completion rate and errands left this week, in one query.
   */
  async standings(agentIds: string[], countryCode: string) {
    if (!agentIds.length)
      return new Map<
        string,
        Pick<History, 'acceptanceRate' | 'countedOffers' | 'completionRate' | 'cancellations7d'>
      >();
    const rules = (await this.countries.currentSettings(countryCode)).settings.matching;
    const all = await this.history(agentIds, rules);
    return new Map(
      agentIds.map((id) => {
        const h = all.get(id)!;
        return [
          id,
          {
            acceptanceRate: h.acceptanceRate,
            countedOffers: h.countedOffers,
            completionRate: h.completionRate,
            cancellations7d: h.cancellations7d,
          },
        ];
      }),
    );
  }

  /**
   * Each agent's own history, in one query. Their acceptance rate (M9) is over their last counted offers, and only
   * once they've had enough of them to go by.
   */
  private async history(
    agentIds: string[],
    rules: Pick<CountrySettings['matching'], 'acceptanceOffers' | 'acceptanceMinOffers'>,
  ): Promise<Map<string, History>> {
    const acceptanceOffers = rules.acceptanceOffers;
    const ids = sql.join(
      agentIds.map((id) => sql`(${id}::uuid)`),
      sql`, `,
    );
    const out = sql.join(
      AGENT_OUT_STATES.map((s) => sql`${s}`),
      sql`, `,
    );
    const { rows } = await this.db.execute<{
      agentId: string;
      completed: number;
      accepted: number;
      withdrawn: number;
      leftThisWeek: number;
      rating: number | null;
      lastEnded: Date | string | null;
      onlineSince: Date | string | null;
      busy: boolean;
      tier: AgentTier | null;
      taken: number;
      answered: number;
    }>(sql`
      select a.id as "agentId",
        (select count(*)::int from errands e where e.agent_id = a.id and e.status = 'completed') as completed,
        recent.accepted, recent.withdrawn,
        (select count(*)::int from errand_events w where w.event in ${LEFT_EVENTS} and w.actor_id = a.id
          and w.created_at > now() - interval '7 days') as "leftThisWeek",
        (select avg(r.stars)::float from (select stars from errand_ratings
          where ratee_id = a.id and rater_role = 'customer' order by created_at desc limit ${RECENT}) r) as rating,
        (select max(greatest(e.completed_at, e.cancelled_at)) from errands e where e.agent_id = a.id) as "lastEnded",
        p.online_since as "onlineSince",
        exists (select 1 from errands e where e.agent_id = a.id and e.status in (${out})
          and not (e.status = 'accepted' and e.scheduled_for > now())) as busy,
        ap.tier,
        offered.taken, offered.answered
      from (values ${ids}) as a(id)
      left join agent_presence p on p.user_id = a.id
      left join agent_profiles ap on ap.user_id = a.id
      left join lateral (${recentAccepts(sql`a.id`)}) recent on true
      left join lateral (
        select count(*) filter (where o.status = 'accepted')::int as taken, count(*)::int as answered
        from (select status from errand_offers where agent_id = a.id and counts
          and status in ('accepted', 'declined', 'expired') order by offered_at desc limit ${acceptanceOffers}) o
      ) offered on true`);
    const now = Date.now();
    const time = (d: Date | string | null) => {
      const ms = d ? new Date(d).getTime() : NaN;
      return Number.isFinite(ms) ? ms : null;
    };
    return new Map(
      rows.map((r) => {
        // Waiting since the last errand ended, or since going online if later; none while they hold one.
        const since = Math.max(time(r.lastEnded) ?? 0, time(r.onlineSince) ?? 0);
        const waitingMinutes = r.busy || !since ? 0 : Math.max(0, (now - since) / 60_000);
        return [
          r.agentId,
          {
            // Of the errands they accepted lately, the share they didn't leave.
            completionRate: completionRate(r),
            // Of their last counted offers, the share they took (M9).
            acceptanceRate: r.answered && r.answered >= rules.acceptanceMinOffers ? r.taken / r.answered : null,
            countedOffers: r.answered,
            onlineSince: time(r.onlineSince) === null ? null : new Date(r.onlineSince!),
            cancellations7d: r.leftThisWeek,
            ratingStars: r.rating,
            completedErrands: r.completed,
            waitingMinutes,
            tier: r.tier ?? 'bronze',
          },
        ];
      }),
    );
  }

  /**
   * The state's average reliability and rating over the last 90 days, for agents with too little history of
   * their own. Worked out at most every ten minutes per state.
   */
  async stateAverages(countryCode: string, stateCode: string): Promise<StateAverages> {
    const key = `rank:averages:${countryCode}:${stateCode}`;
    const kept = await this.redis.client.get(key).catch(() => null);
    if (kept) return JSON.parse(kept) as StateAverages;
    const { rows } = await this.db.execute<{
      accepted: number;
      withdrawn: number;
      rating: number | null;
      taken: number;
      answered: number;
    }>(sql`
      select
        (select count(*) filter (where o.status = 'accepted')::int from errand_offers o join errands e on e.id = o.errand_id
          where o.counts and o.status in ('accepted', 'declined', 'expired') and e.country_code = ${countryCode}
            and e.state_code = ${stateCode} and o.offered_at > now() - interval '90 days') as taken,
        (select count(*)::int from errand_offers o join errands e on e.id = o.errand_id
          where o.counts and o.status in ('accepted', 'declined', 'expired') and e.country_code = ${countryCode}
            and e.state_code = ${stateCode} and o.offered_at > now() - interval '90 days') as answered,
        (select count(*)::int from errand_events ev join errands e on e.id = ev.errand_id
          where ev.event = 'accept' and e.country_code = ${countryCode} and e.state_code = ${stateCode}
            and ev.created_at > now() - interval '90 days') as accepted,
        (select count(*)::int from errand_events ev join errands e on e.id = ev.errand_id
          where ev.event in ${LEFT_EVENTS} and e.country_code = ${countryCode} and e.state_code = ${stateCode}
            and ev.created_at > now() - interval '90 days') as withdrawn,
        (select avg(r.stars)::float from errand_ratings r join errands e on e.id = r.errand_id
          where r.rater_role = 'customer' and e.country_code = ${countryCode} and e.state_code = ${stateCode}
            and r.created_at > now() - interval '90 days') as rating`);
    const row = rows[0]!;
    const average: StateAverages = {
      // Completion and acceptance together, as an agent's own reliability is (M9).
      reliability: averageReliability({
        completion: row.accepted ? Math.max(0, 1 - row.withdrawn / row.accepted) : null,
        acceptance: row.answered ? row.taken / row.answered : null,
      }),
      ratingStars: row.rating ?? NO_HISTORY.ratingStars,
    };
    await this.redis.client.set(key, JSON.stringify(average), 'EX', AVERAGES_SECONDS).catch(() => undefined);
    return average;
  }
}
