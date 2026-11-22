import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { DB, type Db } from '../db/database.module';
import { categories, states, users } from '../db/schema';
import { RankingService } from '../matching/ranking.service';

/** The periods the dashboard looks back over, in days. */
export const DASHBOARD_DAYS = [1, 7, 30] as const;
export type DashboardDays = (typeof DASHBOARD_DAYS)[number];

/** Agents listed at most, by offers received. */
const AGENTS_LISTED = 50;

/** The figures for a group of errands; times in seconds, medians, null with none to go by. */
export interface Figures {
  errands: number;
  urgent: number;
  /** From sent to its first offer, for urgent errands offered. */
  firstOfferSeconds: number | null;
  /** From sent to an agent accepting, the first time, for any errand accepted. */
  acceptSeconds: number | null;
  /** Offers made per urgent errand. */
  offersPerErrand: number | null;
  /** The share of urgent errands whose search reached its last step: open to everyone (M8). */
  everyoneShare: number | null;
  /** The share that expired with no agent. */
  expiredShare: number | null;
  /** Errands taken from an offer whose agent then reached the pickup: those the pickup times are from. */
  pickups: number;
  /** The travel time to the pickup the offer was ranked with, against how long the agent took from accepting. */
  predictedPickupSeconds: number | null;
  actualPickupSeconds: number | null;
}

type Row = {
  state_code: string | null;
  category_key: string | null;
  is_total: boolean;
  errands: number;
  urgent: number;
  first_offer_s: number | null;
  accept_s: number | null;
  offers_per_errand: number | null;
  everyone_share: number | null;
  expired_share: number | null;
  pickups: number;
  predicted_s: number | null;
  actual_s: number | null;
};

const seconds = (n: number | null) => (n === null ? null : Math.round(n));

/**
 * The matching dashboard (docs/matching.md, M15): for errands sent over the last day, week or month, per state and
 * category, how quickly they were offered and taken, how far their search went, and how the predicted pickup time
 * compared with the real one; and per agent, the offers they had and what they did.
 */
@Injectable()
export class MatchingStatsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly ranking: RankingService,
  ) {}

  async dashboard(countryCode: string, days: DashboardDays, stateCode?: string) {
    const since = new Date(Date.now() - days * 86_400_000);
    const [{ places, total }, agents] = await Promise.all([
      this.places(countryCode, since, stateCode),
      this.agents(countryCode, since, stateCode),
    ]);
    return { days, since, places, total, agents };
  }

  private async places(countryCode: string, since: Date, stateCode?: string) {
    const inState = stateCode ? sql`and e.state_code = ${stateCode}` : sql``;
    const { rows } = await this.db.execute<Row>(sql`
      with e as (
        select e.id, e.state_code, e.category_key, e.urgent, e.status, e.created_at, e.broadcast_fee_kobo,
          e.reached_pickup_at, e.agent_id
        from errands e
        where e.country_code = ${countryCode} and e.created_at >= ${since} ${inState}
      ),
      offered as (
        select o.errand_id, min(o.offered_at) as first_at, count(*)::int as n
        from errand_offers o join e on e.id = o.errand_id
        group by o.errand_id
      ),
      accepted as (
        select ev.errand_id, min(ev.created_at) as at
        from errand_events ev join e on e.id = ev.errand_id
        where ev.event = 'accept'
        group by ev.errand_id
      ),
      taken as (
        select distinct on (o.errand_id) o.errand_id, o.agent_id, o.travel_seconds, o.answered_at
        from errand_offers o join e on e.id = o.errand_id
        where o.status = 'accepted'
        order by o.errand_id, o.answered_at desc
      ),
      each as (
        select e.*, f.first_at, coalesce(f.n, 0) as offers, a.at as accepted_at,
          -- The pickup times, only where the agent who reached it is the one the offer was ranked for.
          case when t.agent_id = e.agent_id and e.reached_pickup_at is not null then t.travel_seconds end as predicted,
          case when t.agent_id = e.agent_id and e.reached_pickup_at is not null
            then extract(epoch from e.reached_pickup_at - t.answered_at) end as actual
        from e
        left join offered f on f.errand_id = e.id
        left join accepted a on a.errand_id = e.id
        left join taken t on t.errand_id = e.id
      )
      select state_code, category_key, grouping(state_code, category_key) <> 0 as is_total,
        count(*)::int as errands,
        count(*) filter (where urgent)::int as urgent,
        percentile_cont(0.5) within group (
          order by case when urgent then extract(epoch from first_at - created_at) end) as first_offer_s,
        percentile_cont(0.5) within group (order by extract(epoch from accepted_at - created_at)) as accept_s,
        (avg(offers) filter (where urgent))::float8 as offers_per_errand,
        (avg(case when broadcast_fee_kobo is not null then 1 else 0 end) filter (where urgent))::float8
          as everyone_share,
        (avg(case when status = 'expired' then 1 else 0 end))::float8 as expired_share,
        count(predicted)::int as pickups,
        percentile_cont(0.5) within group (order by predicted) as predicted_s,
        percentile_cont(0.5) within group (order by actual) as actual_s
      from each
      group by grouping sets ((state_code, category_key), ())
      order by is_total, state_code, category_key`);
    const [stateNames, categoryNames] = await Promise.all([
      this.db.select({ code: states.code, name: states.name }).from(states).where(eq(states.countryCode, countryCode)),
      this.db
        .select({ key: categories.key, name: categories.name })
        .from(categories)
        .where(eq(categories.countryCode, countryCode)),
    ]);
    const stateName = new Map(stateNames.map((s) => [s.code, s.name]));
    const categoryName = new Map(categoryNames.map((c) => [c.key, c.name]));
    const figures = (r: Row): Figures => ({
      errands: r.errands,
      urgent: r.urgent,
      firstOfferSeconds: seconds(r.first_offer_s),
      acceptSeconds: seconds(r.accept_s),
      offersPerErrand: r.offers_per_errand,
      everyoneShare: r.everyone_share,
      expiredShare: r.expired_share,
      pickups: r.pickups,
      predictedPickupSeconds: seconds(r.predicted_s),
      actualPickupSeconds: seconds(r.actual_s),
    });
    const totalRow = rows.find((r) => r.is_total);
    return {
      places: rows
        .filter((r) => !r.is_total)
        .map((r) => ({
          stateCode: r.state_code!,
          stateName: stateName.get(r.state_code!) ?? r.state_code!,
          categoryKey: r.category_key!,
          categoryName: categoryName.get(r.category_key!) ?? r.category_key!,
          ...figures(r),
        })),
      total: totalRow ? figures(totalRow) : null,
    };
  }

  /**
   * The agents with the most offers over the period, with what they did with them, and how they stand now: their
   * acceptance rate over their last counted offers, completion rate and errands left this week.
   */
  private async agents(countryCode: string, since: Date, stateCode?: string) {
    const inState = stateCode
      ? sql`and exists (select 1 from errands e where e.id = o.errand_id and e.state_code = ${stateCode})`
      : sql``;
    const { rows } = await this.db.execute<{
      agent_id: string;
      offers: number;
      accepted: number;
      declined: number;
      expired: number;
    }>(sql`
      select o.agent_id, count(*)::int as offers,
        count(*) filter (where o.status = 'accepted')::int as accepted,
        count(*) filter (where o.status = 'declined')::int as declined,
        count(*) filter (where o.status = 'expired')::int as expired
      from errand_offers o
      where o.country_code = ${countryCode} and o.offered_at >= ${since} ${inState}
      group by o.agent_id
      order by offers desc, o.agent_id
      limit ${AGENTS_LISTED}`);
    if (!rows.length) return [];
    const ids = rows.map((r) => r.agent_id);
    const [names, standing] = await Promise.all([
      this.db
        .select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
        .from(users)
        .where(and(inArray(users.id, ids))),
      this.ranking.standings(ids, countryCode),
    ]);
    const byId = new Map(names.map((n) => [n.id, n]));
    return rows.map((r) => ({
      id: r.agent_id,
      firstName: byId.get(r.agent_id)?.firstName ?? null,
      lastName: byId.get(r.agent_id)?.lastName ?? null,
      offers: r.offers,
      accepted: r.accepted,
      declined: r.declined,
      expired: r.expired,
      ...standing.get(r.agent_id)!,
    }));
  }

  /** One agent's offers over the last 30 days, for their page. */
  async agentOffers(agentId: string) {
    const { rows } = await this.db.execute<{ received: number; accepted: number; declined: number; expired: number }>(
      sql`
      select count(*)::int as received,
        count(*) filter (where o.status = 'accepted')::int as accepted,
        count(*) filter (where o.status = 'declined')::int as declined,
        count(*) filter (where o.status = 'expired')::int as expired
      from errand_offers o
      where o.agent_id = ${agentId} and o.offered_at >= now() - interval '30 days'`,
    );
    return rows[0]!;
  }
}
