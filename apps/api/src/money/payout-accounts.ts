import { and, eq, isNull } from 'drizzle-orm';
import type { Db, Tx } from '../db/database.module';
import { payoutAccounts } from '../db/schema';

export type PayoutAccountRow = typeof payoutAccounts.$inferSelect;

/**
 * An agent's live payout accounts, in one read: the approved one withdrawals go to, and a new one waiting for
 * support (the bank's name only nearly matched the legal name). Either may be missing.
 */
export async function liveAccounts(db: Db | Tx, userId: string) {
  const rows = await db
    .select()
    .from(payoutAccounts)
    .where(and(eq(payoutAccounts.userId, userId), isNull(payoutAccounts.replacedAt)));
  return {
    approved: rows.find((r) => r.reviewStatus === 'approved') ?? null,
    pending: rows.find((r) => r.reviewStatus === 'pending') ?? null,
  };
}
