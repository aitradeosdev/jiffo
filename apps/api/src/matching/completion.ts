import { sql, type SQL } from 'drizzle-orm';

/** The accepts an agent's completion rate is over (docs/matching.md, M4), and their rating. */
export const RECENT = 100;

/**
 * Leaving an errand once accepted, as an agent's completion rate counts it: withdrawing, or having a scheduled one
 * taken back for not being online in time (M12). Each names the agent as its actor.
 */
export const LEFT_EVENTS = sql`('withdraw', 'take_back')`;

/** Of the agent's last RECENT accepts, how many there were and how many they left: `accepted` and `withdrawn`. */
export const recentAccepts = (agent: SQL) => sql`
  select count(*)::int as accepted,
    count(*) filter (where exists (select 1 from errand_events w
      where w.errand_id = acc.errand_id and w.event in ${LEFT_EVENTS} and w.actor_id = ${agent}))::int as withdrawn
  from (select ev.errand_id from errand_events ev where ev.event = 'accept' and ev.actor_id = ${agent}
    order by ev.id desc limit ${RECENT}) acc`;

/** The share of those they didn't leave; null with none to count. */
export const completionRate = (r: { accepted: number; withdrawn: number }) =>
  r.accepted ? 1 - r.withdrawn / r.accepted : null;
