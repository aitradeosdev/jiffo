import { Inject, Injectable } from '@nestjs/common';
import { asc, desc, eq, sql, type SQL } from 'drizzle-orm';
import { AGENT_OUT_STATES } from '@jiffo/shared';
import { DB, type Db } from '../db/database.module';
import { countries, reconciliationRuns } from '../db/schema';
import { notFound } from '../common/errors';

const num = (v: unknown) => Number(v ?? 0);

/** The numbers on the admin overview, for one country. "Today" is the country's own day. */
@Injectable()
export class OverviewService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** The countries Jiffo runs in, for the panel's country switch. */
  countries() {
    return this.db
      .select({
        code: countries.code,
        name: countries.name,
        currency: countries.currency,
        timezone: countries.timezone,
      })
      .from(countries)
      .where(eq(countries.enabled, true))
      .orderBy(asc(countries.name));
  }

  async overview(countryCode: string) {
    const [country] = await this.db.select().from(countries).where(eq(countries.code, countryCode));
    if (!country) throw notFound('country_not_found', 'Country not found');
    const tz = country.timezone;
    // The start of today in the country's time zone, as a timestamp.
    const today = sql`(date_trunc('day', now() at time zone ${tz}) at time zone ${tz})`;
    const out = sql.join(
      AGENT_OUT_STATES.map((s) => sql`${s}`),
      sql`, `,
    );
    const one = async (query: SQL) => (await this.db.execute(query)).rows[0] ?? {};

    const [errands, agents, money, balances, attention, week, reconciliation] = await Promise.all([
      one(sql`
        select
          count(*) filter (where status = 'requested') as waiting,
          count(*) filter (where status in (${out})) as live,
          count(*) filter (where status = 'disputed') as disputed,
          count(*) filter (where status = 'completed' and completed_at >= ${today}) as completed_today,
          count(*) filter (where status = 'cancelled' and cancelled_at >= ${today}) as cancelled_today,
          count(*) filter (where status = 'expired' and updated_at >= ${today}) as expired_today,
          count(*) filter (where created_at >= ${today}) as requested_today
        from errands where country_code = ${countryCode}`),
      one(sql`
        select
          (select count(*) from agent_presence where country_code = ${countryCode} and online) as online,
          (select count(distinct agent_id) from errands
            where country_code = ${countryCode} and status in (${out})) as on_errand`),
      one(sql`
        select
          (select coalesce(sum(fee_kobo + service_fee_kobo), 0) from errands
            where country_code = ${countryCode} and status = 'completed' and completed_at >= ${today}) as fees,
          (select coalesce(-sum(p.amount), 0) from postings p join ledger_accounts a on a.id = p.account_id
            where a.type = 'platform_revenue' and a.country_code = ${countryCode} and p.created_at >= ${today}) as revenue,
          (select count(*) from deposits
            where country_code = ${countryCode} and status = 'succeeded' and completed_at >= ${today}) as top_up_count,
          (select coalesce(sum(paid_kobo), 0) from deposits
            where country_code = ${countryCode} and status = 'succeeded' and completed_at >= ${today}) as top_ups,
          (select coalesce(sum(fees_kobo), 0) from deposits
            where country_code = ${countryCode} and status = 'succeeded' and completed_at >= ${today}) as absorbed_fees,
          (select count(*) from payouts
            where country_code = ${countryCode} and status = 'succeeded' and completed_at >= ${today}) as payout_count,
          (select coalesce(sum(amount_kobo), 0) from payouts
            where country_code = ${countryCode} and status = 'succeeded' and completed_at >= ${today}) as payouts`),
      one(sql`
        select
          coalesce(sum(balance) filter (where type = 'customer_wallet'), 0) as wallets,
          coalesce(sum(balance) filter (where type in ('agent_available', 'agent_held')), 0) as agents,
          coalesce(sum(balance) filter (where type in ('fee_escrow', 'item_escrow')), 0) as escrow
        from ledger_accounts where country_code = ${countryCode}`),
      one(sql`
        select
          (select count(*) from payouts where country_code = ${countryCode} and status = 'failed'
            and created_at >= now() - interval '7 days') as failed_payouts,
          (select count(*) from deposits where country_code = ${countryCode} and sender_mismatch
            and created_at >= now() - interval '7 days') as sender_mismatch,
          (select count(*) from agent_applications where country_code = ${countryCode}
            and status = 'review') as applications,
          (select count(*) from customer_verifications v join users u on u.id = v.user_id
            where u.country_code = ${countryCode} and v.status = 'review') as id_checks`),
      this.db.execute(sql`
        with days as (
          select generate_series(
            date_trunc('day', now() at time zone ${tz}) - interval '6 days',
            date_trunc('day', now() at time zone ${tz}),
            interval '1 day') as day
        )
        select to_char(d.day, 'YYYY-MM-DD') as day,
          (select count(*) from errands e where e.country_code = ${countryCode} and e.status = 'completed'
            and e.completed_at >= (d.day at time zone ${tz})
            and e.completed_at < ((d.day + interval '1 day') at time zone ${tz})) as completed,
          (select coalesce(-sum(p.amount), 0) from postings p join ledger_accounts a on a.id = p.account_id
            where a.type = 'platform_revenue' and a.country_code = ${countryCode}
            and p.created_at >= (d.day at time zone ${tz})
            and p.created_at < ((d.day + interval '1 day') at time zone ${tz})) as revenue
        from days d order by d.day`),
      this.db
        .select()
        .from(reconciliationRuns)
        .where(eq(reconciliationRuns.countryCode, countryCode))
        .orderBy(desc(reconciliationRuns.createdAt))
        .limit(1),
    ]);

    const run = reconciliation[0];
    return {
      country: { code: country.code, name: country.name, currency: country.currency, timezone: tz },
      errands: {
        waiting: num(errands.waiting),
        live: num(errands.live),
        disputed: num(errands.disputed),
        requestedToday: num(errands.requested_today),
        completedToday: num(errands.completed_today),
        cancelledToday: num(errands.cancelled_today),
        expiredToday: num(errands.expired_today),
      },
      agents: { online: num(agents.online), onErrand: num(agents.on_errand) },
      today: {
        errandFeesKobo: num(money.fees),
        revenueKobo: num(money.revenue),
        topUps: num(money.top_up_count),
        topUpsKobo: num(money.top_ups),
        /** What the payment provider charged on top-ups, which Jiffo pays instead of the customer. */
        absorbedFeesKobo: num(money.absorbed_fees),
        payouts: num(money.payout_count),
        payoutsKobo: num(money.payouts),
      },
      /** Money Jiffo holds for people right now. */
      balances: {
        customerWalletsKobo: num(balances.wallets),
        agentBalancesKobo: num(balances.agents),
        escrowKobo: num(balances.escrow),
      },
      attention: {
        disputes: num(errands.disputed),
        failedPayouts7d: num(attention.failed_payouts),
        senderMismatch7d: num(attention.sender_mismatch),
        /** Agent applications the checks sent to support. */
        applications: num(attention.applications),
        /** Customers' ID checks the provider sent to support. */
        idChecks: num(attention.id_checks),
      },
      week: week.rows.map((r) => ({ day: String(r.day), completed: num(r.completed), revenueKobo: num(r.revenue) })),
      reconciliation: run
        ? {
            at: run.createdAt,
            differenceKobo: run.differenceKobo,
            pendingDeposits: run.pendingDeposits,
            stuckPayouts: run.stuckPayouts,
          }
        : null,
    };
  }
}
