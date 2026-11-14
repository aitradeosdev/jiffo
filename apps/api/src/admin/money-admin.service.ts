import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import { DB, type Db } from '../db/database.module';
import {
  countries,
  deposits,
  devices,
  errands,
  payoutAccounts,
  payouts,
  reconciliationRuns,
  users,
} from '../db/schema';
import { conflict, notFound, unprocessable } from '../common/errors';
import { InsufficientFunds, LedgerService, transfer, type AccountRef } from '../money/ledger.service';
import { AuditService } from './audit.service';
import { requireCountry } from './countries';
import { containing, cursorOf, exactTime, parseCursor, phoneDigits } from './list-helpers';
import type { AdminContext } from './admin.types';

/** The most one adjustment may move. Larger corrections are split, so each one is looked at. */
export const MAX_ADJUSTMENT_KOBO = 100_000_000;

/** What revenue and provider charges came from, by journal kind, in words the panel shows. */
const REVENUE_SOURCES: Record<string, string> = {
  settle: 'Service fees and commission',
  payout: 'Instant withdrawal fees',
  payout_reversed: 'Withdrawal fees returned',
  adjustment: 'Adjustments',
};
const PROVIDER_CHARGES: Record<string, string> = {
  deposit: 'Top-up fees, one-time account numbers',
  fixed_deposit: 'Top-up fees, own account numbers',
  fixed_account: 'Own account numbers issued',
  payout_sent: 'Transfer fees',
};

export interface AdjustmentInput {
  personId: string;
  account: 'customer_wallet' | 'agent_available';
  direction: 'credit' | 'debit';
  amountKobo: number;
  note: string;
  errandId?: string;
  /** From the panel's form, so a double submit posts once. */
  requestId: string;
}

/** Money as finance sees it: what Jiffo holds and earns, top-ups, withdrawals, the nightly check, adjustments. */
@Injectable()
export class MoneyAdminService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
  ) {}

  /** Balances now, and where revenue and provider charges came from over the last `days` days. */
  async summary(country: string, days: number) {
    const c = await requireCountry(this.db, country);
    const tz = c.timezone;
    // The same window for the totals and the chart: whole local days, today included.
    const since = sql`(date_trunc('day', now() at time zone ${tz}) - make_interval(days => ${days - 1})) at time zone ${tz}`;
    const rows = async (query: SQL) => (await this.db.execute(query)).rows;
    const [held, platform, revenue, charges, topUps, withdrawals, daily, fixed] = await Promise.all([
      rows(sql`select type, coalesce(sum(balance), 0)::bigint as kobo from ledger_accounts
        where country_code = ${country} and owner_id is not null group by type`),
      // Platform accounts aren't kept as a running balance; they are the sum of their postings, read
      // account by account through the postings index.
      rows(sql`select a.type,
          (select coalesce(sum(p.amount), 0) from postings p where p.account_id = a.id)::bigint as kobo
        from ledger_accounts a where a.country_code = ${country} and a.owner_id is null`),
      rows(sql`select j.kind, coalesce(-sum(p.amount), 0)::bigint as kobo from postings p
        join ledger_accounts a on a.id = p.account_id join journal_entries j on j.id = p.journal_id
        where a.country_code = ${country} and a.type = 'platform_revenue' and p.created_at >= ${since}
        group by j.kind order by 2 desc`),
      rows(sql`select j.kind, coalesce(sum(p.amount), 0)::bigint as kobo from postings p
        join ledger_accounts a on a.id = p.account_id join journal_entries j on j.id = p.journal_id
        where a.country_code = ${country} and a.type = 'provider_fees' and p.created_at >= ${since}
        group by j.kind order by 2 desc`),
      rows(sql`select method, count(*)::int as n, coalesce(sum(paid_kobo), 0)::bigint as kobo,
          coalesce(sum(fees_kobo), 0)::bigint as fees,
          count(*) filter (where sender_mismatch)::int as mismatched
        from deposits where country_code = ${country} and status = 'succeeded' and completed_at >= ${since}
        group by method`),
      rows(sql`select count(*) filter (where status = 'succeeded')::int as n,
          coalesce(sum(send_kobo) filter (where status = 'succeeded'), 0)::bigint as kobo,
          count(*) filter (where status = 'failed')::int as failed,
          count(*) filter (where status in ('requested', 'processing'))::int as pending
        from payouts where country_code = ${country} and created_at >= ${since}`),
      // One pass over the window's postings, grouped by local day, then laid over every day so quiet days show.
      rows(sql`with days as (
          select to_char(generate_series(date_trunc('day', now() at time zone ${tz}) - make_interval(days => ${days - 1}),
            date_trunc('day', now() at time zone ${tz}), interval '1 day'), 'YYYY-MM-DD') as day),
        sums as (
          select to_char(p.created_at at time zone ${tz}, 'YYYY-MM-DD') as day,
            coalesce(-sum(p.amount) filter (where a.type = 'platform_revenue'), 0) as revenue,
            coalesce(sum(p.amount) filter (where a.type = 'provider_fees'), 0) as charges
          from postings p join ledger_accounts a on a.id = p.account_id
          where a.country_code = ${country} and a.type in ('platform_revenue', 'provider_fees') and p.created_at >= ${since}
          group by 1)
        select d.day, coalesce(s.revenue, 0)::bigint as revenue, coalesce(s.charges, 0)::bigint as charges
        from days d left join sums s on s.day = d.day order by d.day`),
      // Own account numbers: issued in the window and what that cost, and how many there are now.
      rows(sql`select count(*) filter (where activated_at >= ${since})::int as issued,
          coalesce(sum(issue_fee_kobo) filter (where activated_at >= ${since}), 0)::bigint as cost,
          count(*) filter (where status = 'active')::int as active,
          count(*) filter (where status = 'pending')::int as pending,
          count(*) filter (where status = 'failed' and updated_at >= ${since})::int as failed
        from fixed_accounts where country_code = ${country}`),
    ]);
    const n = (v: unknown) => Number(v ?? 0);
    const byType = (list: Record<string, unknown>[], type: string) => n(list.find((r) => r.type === type)?.kobo);
    const w = withdrawals[0] ?? {};
    const f = fixed[0] ?? {};
    const method = (m: string) => {
      const r = topUps.find((row) => row.method === m) ?? {};
      return { count: n(r.n), kobo: n(r.kobo), feesKobo: n(r.fees) };
    };
    const total = (key: string) => topUps.reduce((acc, r) => acc + n(r[key]), 0);
    const revenueKobo = revenue.reduce((acc, r) => acc + n(r.kobo), 0);
    const chargesKobo = charges.reduce((acc, r) => acc + n(r.kobo), 0);
    return {
      days,
      held: {
        customerWalletsKobo: byType(held, 'customer_wallet'),
        agentAvailableKobo: byType(held, 'agent_available'),
        agentHeldKobo: byType(held, 'agent_held'),
        escrowKobo: byType(held, 'fee_escrow') + byType(held, 'item_escrow'),
      },
      platform: {
        // Cash and fees are debit-normal; revenue and money on its way out are owed, so read with the sign flipped.
        providerCashKobo: byType(platform, 'provider_cash'),
        revenueKobo: -byType(platform, 'platform_revenue'),
        providerFeesKobo: byType(platform, 'provider_fees'),
        inTransitKobo: -byType(platform, 'payouts_in_transit'),
        /** Everything earned, less everything providers charged, since the start. */
        netRevenueKobo: -byType(platform, 'platform_revenue') - byType(platform, 'provider_fees'),
      },
      /** The window's revenue, what providers charged in it, and what is left: what Jiffo actually made. */
      earnings: { revenueKobo, providerChargesKobo: chargesKobo, netRevenueKobo: revenueKobo - chargesKobo },
      revenue: revenue.map((r) => ({
        kind: String(r.kind),
        label: REVENUE_SOURCES[String(r.kind)] ?? String(r.kind),
        kobo: n(r.kobo),
      })),
      providerCharges: charges.map((r) => ({
        kind: String(r.kind),
        label: PROVIDER_CHARGES[String(r.kind)] ?? String(r.kind),
        kobo: n(r.kobo),
      })),
      topUps: {
        count: total('n'),
        kobo: total('kobo'),
        feesKobo: total('fees'),
        senderMismatch: total('mismatched'),
        oneTime: method('one_time'),
        fixed: method('fixed'),
      },
      fixedAccounts: {
        issued: n(f.issued),
        issueCostKobo: n(f.cost),
        active: n(f.active),
        pending: n(f.pending),
        failed: n(f.failed),
      },
      withdrawals: { count: n(w.n), kobo: n(w.kobo), failed: n(w.failed), pending: n(w.pending) },
      daily: daily.map((r) => ({
        day: String(r.day),
        revenueKobo: n(r.revenue),
        chargesKobo: n(r.charges),
        netKobo: n(r.revenue) - n(r.charges),
      })),
    };
  }

  /** Top-ups, newest first. */
  async deposits(query: {
    country: string;
    filter: 'all' | 'pending' | 'expired' | 'failed' | 'mismatch';
    q?: string;
    before?: string;
    limit: number;
  }) {
    const cursor = parseCursor(query.before);
    const rows = await this.db
      .select({
        id: deposits.id,
        cursorAt: exactTime(deposits.createdAt),
        createdAt: deposits.createdAt,
        completedAt: deposits.completedAt,
        status: deposits.status,
        method: deposits.method,
        expiresAt: deposits.expiresAt,
        reference: deposits.reference,
        amountKobo: deposits.amountKobo,
        paidKobo: deposits.paidKobo,
        feesKobo: deposits.feesKobo,
        senderName: deposits.senderName,
        senderBank: deposits.senderBank,
        senderMismatch: deposits.senderMismatch,
        person: { id: users.id, firstName: users.firstName, lastName: users.lastName, phone: users.phone },
      })
      .from(deposits)
      .innerJoin(users, eq(users.id, deposits.userId))
      .where(
        and(
          eq(deposits.countryCode, query.country),
          // Waiting means still open: a top-up nobody paid into stays 'pending' after its account number expires.
          query.filter === 'pending'
            ? and(eq(deposits.status, 'pending'), sql`${deposits.expiresAt} > now()`)
            : undefined,
          query.filter === 'expired'
            ? and(eq(deposits.status, 'pending'), sql`${deposits.expiresAt} <= now()`)
            : undefined,
          query.filter === 'failed' ? eq(deposits.status, 'failed') : undefined,
          query.filter === 'mismatch' ? eq(deposits.senderMismatch, true) : undefined,
          query.q ? this.personOrReference(query.q, deposits.reference) : undefined,
          cursor
            ? sql`(${deposits.createdAt}, ${deposits.id}) < (${cursor.at}::timestamptz, ${cursor.id}::uuid)`
            : undefined,
        ),
      )
      .orderBy(desc(deposits.createdAt), desc(deposits.id))
      .limit(query.limit + 1);
    const now = Date.now();
    const page = this.page(rows, query.limit, 'deposits');
    return {
      ...page,
      deposits: page.deposits.map(({ expiresAt, ...d }) => ({
        ...d,
        status: d.status === 'pending' && expiresAt && expiresAt.getTime() <= now ? ('expired' as const) : d.status,
      })),
    };
  }

  /** Withdrawals, newest first, with the bank they went to (last four digits only). */
  async payouts(query: {
    country: string;
    filter: 'all' | 'pending' | 'failed';
    q?: string;
    before?: string;
    limit: number;
  }) {
    const cursor = parseCursor(query.before);
    const rows = await this.db
      .select({
        id: payouts.id,
        cursorAt: exactTime(payouts.createdAt),
        createdAt: payouts.createdAt,
        completedAt: payouts.completedAt,
        status: payouts.status,
        speed: payouts.speed,
        reference: payouts.reference,
        amountKobo: payouts.amountKobo,
        feeKobo: payouts.feeKobo,
        sendKobo: payouts.sendKobo,
        failureReason: payouts.failureReason,
        bankName: payoutAccounts.bankName,
        accountName: payoutAccounts.accountName,
        accountLast4: sql<string>`right(${payoutAccounts.accountNumber}, 4)`,
        person: { id: users.id, firstName: users.firstName, lastName: users.lastName, phone: users.phone },
      })
      .from(payouts)
      .innerJoin(users, eq(users.id, payouts.userId))
      .innerJoin(payoutAccounts, eq(payoutAccounts.id, payouts.payoutAccountId))
      .where(
        and(
          eq(payouts.countryCode, query.country),
          query.filter === 'pending' ? inArray(payouts.status, ['requested', 'processing']) : undefined,
          query.filter === 'failed' ? eq(payouts.status, 'failed') : undefined,
          query.q ? this.personOrReference(query.q, payouts.reference) : undefined,
          cursor
            ? sql`(${payouts.createdAt}, ${payouts.id}) < (${cursor.at}::timestamptz, ${cursor.id}::uuid)`
            : undefined,
        ),
      )
      .orderBy(desc(payouts.createdAt), desc(payouts.id))
      .limit(query.limit + 1);
    return this.page(rows, query.limit, 'payouts');
  }

  private personOrReference(text: string, reference: typeof deposits.reference | typeof payouts.reference) {
    const like = containing(text);
    const phone = phoneDigits(text);
    return or(
      ilike(reference, like),
      ilike(sql`coalesce(${users.firstName}, '') || ' ' || coalesce(${users.lastName}, '')`, like),
      phone ? ilike(users.phone, `%${phone}%`) : undefined,
    );
  }

  private page<T extends { cursorAt: string; id: string }, K extends string>(rows: T[], limit: number, key: K) {
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      [key]: page.map(({ cursorAt: _, ...r }) => r),
      next: rows.length > limit && last ? cursorOf(last) : null,
    } as Record<K, Array<Omit<T, 'cursorAt'>>> & { next: string | null };
  }

  /** The nightly checks of the ledger's cash against the payment provider, newest first. */
  reconciliation(country: string) {
    return this.db
      .select()
      .from(reconciliationRuns)
      .where(eq(reconciliationRuns.countryCode, country))
      .orderBy(desc(reconciliationRuns.createdAt))
      .limit(60);
  }

  /**
   * Finance corrects a balance by hand: a credit is paid by Jiffo out of revenue (a goodwill credit or a
   * refund after the fact); a debit takes money back into revenue (recovering an overpayment). A debit
   * can't take more than the account holds. Every adjustment needs a reason and is audited; a repeated
   * request id posts nothing the second time.
   */
  async adjust(admin: AdminContext, input: AdjustmentInput) {
    return this.db.transaction(async (tx) => {
      const [person] = await tx.select().from(users).where(eq(users.id, input.personId)).for('update');
      if (!person) throw notFound('person_not_found', 'Person not found');
      const app = input.account === 'customer_wallet' ? 'customer' : 'agent';
      const [usesApp] = await tx
        .select({ id: devices.id })
        .from(devices)
        .where(and(eq(devices.userId, person.id), eq(devices.app, app)))
        .limit(1);
      if (!usesApp) {
        throw unprocessable(
          'wrong_account',
          `This person has no ${app === 'customer' ? 'customer wallet' : 'agent balance'}`,
        );
      }
      if (input.errandId) {
        const [errand] = await tx
          .select({ id: errands.id })
          .from(errands)
          .where(
            and(eq(errands.id, input.errandId), or(eq(errands.customerId, person.id), eq(errands.agentId, person.id))),
          );
        if (!errand) throw unprocessable('errand_not_theirs', 'That errand is not one of theirs');
      }
      const [{ currency } = { currency: 'NGN' }] = await tx
        .select({ currency: countries.currency })
        .from(countries)
        .where(eq(countries.code, person.countryCode));
      const account: AccountRef = { type: input.account, ownerId: person.id };
      const revenue: AccountRef = { type: 'platform_revenue' };
      try {
        const posted = await this.ledger.post(tx, {
          key: `adjustment:${input.requestId}`,
          kind: 'adjustment',
          countryCode: person.countryCode,
          currency,
          errandId: input.errandId ?? null,
          memo: input.note,
          data: { adminId: admin.adminId, direction: input.direction, note: input.note },
          movements: [
            input.direction === 'credit'
              ? transfer(revenue, account, input.amountKobo)
              : transfer(account, revenue, input.amountKobo),
          ],
        });
        if (!posted) return { posted: false };
      } catch (error) {
        if (error instanceof InsufficientFunds) {
          throw conflict('balance_too_low', "That's more than the account holds");
        }
        throw error;
      }
      await this.audit.record(tx, admin, {
        action: 'money.adjust',
        targetType: 'person',
        targetId: person.id,
        countryCode: person.countryCode,
        data: {
          account: input.account,
          direction: input.direction,
          amountKobo: input.amountKobo,
          note: input.note,
          errandId: input.errandId ?? null,
        },
      });
      return { posted: true };
    });
  }
}
