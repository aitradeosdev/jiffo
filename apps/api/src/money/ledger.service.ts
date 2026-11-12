import { Injectable } from '@nestjs/common';
import { asc, eq, inArray, sql } from 'drizzle-orm';
import type { Tx } from '../db/database.module';
import { journalEntries, ledgerAccounts, postings, type LedgerAccountType } from '../db/schema';
import { ApiError } from '../common/errors';

const CREDIT_NORMAL: ReadonlySet<LedgerAccountType> = new Set([
  'customer_wallet',
  'agent_available',
  'agent_held',
  'fee_escrow',
  'item_escrow',
  'payouts_in_transit',
  'platform_revenue',
]);
/** Accounts that are allowed below zero. Cash can briefly read negative between a payout and the deposit that funds it. */
const MAY_GO_NEGATIVE: ReadonlySet<LedgerAccountType> = new Set(['provider_cash', 'provider_fees']);
const PLATFORM: ReadonlySet<LedgerAccountType> = new Set([
  'payouts_in_transit',
  'platform_revenue',
  'provider_cash',
  'provider_fees',
]);

export interface AccountRef {
  type: LedgerAccountType;
  /** The user or errand. Leave out for platform accounts. */
  ownerId?: string;
}

/** One double entry: the amount is debited to one account and credited to the other. */
export interface Movement {
  debit: AccountRef;
  credit: AccountRef;
  amountKobo: number;
}

/**
 * Money passing between two accounts the platform owes (wallets, escrows, earnings, revenue):
 * the `from` balance goes down and the `to` balance goes up.
 */
export const transfer = (from: AccountRef, to: AccountRef, amountKobo: number): Movement => ({
  debit: from,
  credit: to,
  amountKobo,
});

export interface JournalInput {
  /** Unique per movement, e.g. "errand:<id>:settle". Posting the same key twice does nothing the second time. */
  key: string;
  kind: string;
  countryCode: string;
  currency: string;
  errandId?: string | null;
  memo?: string;
  data?: Record<string, unknown>;
  movements: Movement[];
}

export const accountKey = (ref: AccountRef, countryCode: string) =>
  PLATFORM.has(ref.type) ? `${ref.type}:${countryCode}` : `${ref.type}:${ref.ownerId}`;

/** Thrown inside a transaction when an account would go below zero. */
export class InsufficientFunds extends ApiError {
  constructor(
    readonly accountType: LedgerAccountType,
    details: Record<string, unknown>,
  ) {
    super(409, 'insufficient_funds', 'Not enough money in the wallet. Top up and try again.', details);
  }
}

/**
 * The double-entry ledger: the only code that changes a balance. Every movement takes money from one
 * account and gives it to another, so each journal's postings sum to zero and no kobo appears or
 * disappears. It always runs inside the caller's transaction.
 */
@Injectable()
export class LedgerService {
  /** Gets or creates the account and locks it for the rest of the transaction. */
  private async lockAccounts(tx: Tx, refs: AccountRef[], countryCode: string, currency: string) {
    const wanted = new Map(refs.map((r) => [accountKey(r, countryCode), r]));
    await tx
      .insert(ledgerAccounts)
      .values(
        [...wanted].map(([key, r]) => ({
          key,
          type: r.type,
          countryCode,
          currency,
          ownerId: PLATFORM.has(r.type) ? null : r.ownerId!,
          normal: CREDIT_NORMAL.has(r.type) ? ('credit' as const) : ('debit' as const),
          allowNegative: MAY_GO_NEGATIVE.has(r.type),
        })),
      )
      .onConflictDoNothing({ target: ledgerAccounts.key });
    // Locking in key order means two transactions touching the same accounts never deadlock.
    const rows = await tx
      .select()
      .from(ledgerAccounts)
      .where(inArray(ledgerAccounts.key, [...wanted.keys()]))
      .orderBy(asc(ledgerAccounts.key))
      .for('update');
    return new Map(rows.map((r) => [r.key, r]));
  }

  /** Posts the movements once. Returns false if a journal with this key already exists. */
  async post(tx: Tx, input: JournalInput): Promise<boolean> {
    const movements = input.movements.filter((m) => m.amountKobo !== 0);
    for (const m of movements) {
      if (!Number.isSafeInteger(m.amountKobo) || m.amountKobo < 0) {
        throw new Error(`Ledger amounts are whole, positive kobo: got ${m.amountKobo} in ${input.key}`);
      }
    }

    const [journal] = await tx
      .insert(journalEntries)
      .values({
        key: input.key,
        kind: input.kind,
        countryCode: input.countryCode,
        errandId: input.errandId ?? null,
        memo: input.memo ?? '',
        data: input.data ?? {},
      })
      .onConflictDoNothing({ target: journalEntries.key })
      .returning({ id: journalEntries.id });
    if (!journal) return false;
    if (movements.length === 0) return true;

    const accounts = await this.lockAccounts(
      tx,
      movements.flatMap((m) => [m.debit, m.credit]),
      input.countryCode,
      input.currency,
    );
    const delta = new Map<string, number>(); // signed: + debit, - credit
    for (const m of movements) {
      const debit = accountKey(m.debit, input.countryCode);
      const credit = accountKey(m.credit, input.countryCode);
      delta.set(debit, (delta.get(debit) ?? 0) + m.amountKobo);
      delta.set(credit, (delta.get(credit) ?? 0) - m.amountKobo);
    }

    const lines: Array<{ journalId: string; accountId: string; amount: number }> = [];
    for (const [key, amount] of delta) {
      if (amount === 0) continue;
      const account = accounts.get(key)!;
      const balance = account.balance + (account.normal === 'debit' ? amount : -amount);
      if (balance < 0 && !account.allowNegative) {
        throw new InsufficientFunds(account.type, {
          balanceKobo: account.balance,
          neededKobo: account.balance - balance,
        });
      }
      await tx.update(ledgerAccounts).set({ balance }).where(eq(ledgerAccounts.id, account.id));
      lines.push({ journalId: journal.id, accountId: account.id, amount });
    }
    if (lines.reduce((sum, l) => sum + l.amount, 0) !== 0) throw new Error(`Journal ${input.key} does not balance`);
    if (lines.length > 0) await tx.insert(postings).values(lines);
    return true;
  }

  async balance(tx: Tx, ref: AccountRef, countryCode: string): Promise<number> {
    const [row] = await tx
      .select({ balance: ledgerAccounts.balance })
      .from(ledgerAccounts)
      .where(eq(ledgerAccounts.key, accountKey(ref, countryCode)));
    return row?.balance ?? 0;
  }

  /** Total of every posting ever made. A balanced ledger always answers 0. */
  async trialBalance(tx: Tx): Promise<number> {
    const [row] = await tx.select({ total: sql<string>`coalesce(sum(${postings.amount}), 0)` }).from(postings);
    return Number(row?.total ?? 0);
  }
}
