import { Inject, Injectable } from '@nestjs/common';
import {
  AGENT_OUT_STATES,
  byRank,
  rankScore,
  type AgentTier,
  type RankInputs,
  type RankParts,
  type StateAverages,
} from '@jiffo/shared';
import { eq, sql } from 'drizzle-orm';
import { CountriesService } from '../countries/countries.service';
import { DB, type Db } from '../db/database.module';
import { errands } from '../db/schema';
import { CandidatesService, type Candidate } from './candidates.service';
import { MatchingRedis } from './matching-redis';

/** A candidate with their score for the errand, and its parts (kept with each offer, M15). */
export interface Ranked extends Candidate {
  score: number;
  parts: RankParts;
}

/** Errands of their own that count: their last 100 accepted, and their last 100 ratings (M4). */
const RECENT = 100;
/** How long a state's averages are used before being worked out again. */
const AVERAGES_SECONDS = 10 * 60;
/** A state with no history yet: every agent reliable, rated four and a half stars. */
const NO_HISTORY: StateAverages = { reliability: 1, ratingStars: 4.5 };

type History = Omit<RankInputs, 'travelSeconds'>;

/**
 * Who is offered an errand first (docs/matching.md, M4): the candidates (CandidatesService), each scored by
 * rankScore in @jiffo/shared from their travel time and their own history, highest first.
 */
@Injectable()
export class RankingService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly countries: CountriesService,
    private readonly candidates: CandidatesService,
    private readonly redis: MatchingRedis,
  ) {}

  /** `skip` and `radiusKm`: who is left out, and how far to look (CandidatesService.forErrand). */
  async ranked(errandId: string, skip?: ReadonlySet<string>, radiusKm?: number): Promise<Ranked[]> {
    const found = await this.candidates.forErrand(errandId, skip, radiusKm);
    if (!found.length) return [];
    const [errand] = await this.db
      .select({ countryCode: errands.countryCode, stateCode: errands.stateCode })
      .from(errands)
      .where(eq(errands.id, errandId));
    const rules = (await this.countries.currentSettings(errand!.countryCode)).settings.matching;
    const [history, average] = await Promise.all([
      this.history(found.map((c) => c.agentId)),
      this.stateAverages(errand!.countryCode, errand!.stateCode),
    ]);
    return found
      .map((c) => {
        const parts = rankScore(
          { travelSeconds: c.travel.durationSeconds, ...history.get(c.agentId)! },
          rules,
          average,
        );
        return { ...c, score: parts.total, parts, travelSeconds: c.travel.durationSeconds };
      })
      .sort(byRank)
      .map(({ travelSeconds: _, ...r }) => r);
  }

  /** Each agent's own history, in one query. */
  private async history(agentIds: string[]): Promise<Map<string, History>> {
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
    }>(sql`
      select a.id as "agentId",
        (select count(*)::int from errands e where e.agent_id = a.id and e.status = 'completed') as completed,
        recent.accepted, recent.withdrawn,
        (select count(*)::int from errand_events w where w.event = 'withdraw' and w.actor_id = a.id
          and w.created_at > now() - interval '7 days') as "leftThisWeek",
        (select avg(r.stars)::float from (select stars from errand_ratings
          where ratee_id = a.id and rater_role = 'customer' order by created_at desc limit ${RECENT}) r) as rating,
        (select max(greatest(e.completed_at, e.cancelled_at)) from errands e where e.agent_id = a.id) as "lastEnded",
        p.online_since as "onlineSince",
        exists (select 1 from errands e where e.agent_id = a.id and e.status in (${out})
          and not (e.status = 'accepted' and e.scheduled_for > now())) as busy,
        ap.tier
      from (values ${ids}) as a(id)
      left join agent_presence p on p.user_id = a.id
      left join agent_profiles ap on ap.user_id = a.id
      left join lateral (
        select count(*)::int as accepted,
          count(*) filter (where exists (select 1 from errand_events w
            where w.errand_id = acc.errand_id and w.event = 'withdraw' and w.actor_id = a.id))::int as withdrawn
        from (select ev.errand_id from errand_events ev where ev.event = 'accept' and ev.actor_id = a.id
          order by ev.id desc limit ${RECENT}) acc
      ) recent on true`);
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
            completionRate: r.accepted ? 1 - r.withdrawn / r.accepted : null,
            // Counted once offers are (M9).
            acceptanceRate: null,
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
    const { rows } = await this.db.execute<{ accepted: number; withdrawn: number; rating: number | null }>(sql`
      select
        (select count(*)::int from errand_events ev join errands e on e.id = ev.errand_id
          where ev.event = 'accept' and e.country_code = ${countryCode} and e.state_code = ${stateCode}
            and ev.created_at > now() - interval '90 days') as accepted,
        (select count(*)::int from errand_events ev join errands e on e.id = ev.errand_id
          where ev.event = 'withdraw' and e.country_code = ${countryCode} and e.state_code = ${stateCode}
            and ev.created_at > now() - interval '90 days') as withdrawn,
        (select avg(r.stars)::float from errand_ratings r join errands e on e.id = r.errand_id
          where r.rater_role = 'customer' and e.country_code = ${countryCode} and e.state_code = ${stateCode}
            and r.created_at > now() - interval '90 days') as rating`);
    const row = rows[0]!;
    const average: StateAverages = {
      reliability: row.accepted ? Math.max(0, 1 - row.withdrawn / row.accepted) : NO_HISTORY.reliability,
      ratingStars: row.rating ?? NO_HISTORY.ratingStars,
    };
    await this.redis.client.set(key, JSON.stringify(average), 'EX', AVERAGES_SECONDS).catch(() => undefined);
    return average;
  }
}
