import { Client } from 'pg';
import { afterAll } from 'vitest';

/**
 * After every test file, the ledger's rules hold over everything the run has posted so far
 * (docs/security-plan.md, L11): every journal sums to zero, every person's and errand's account equals its
 * postings and is never below zero, and a finished errand's escrows are empty.
 */
afterAll(async () => {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    const problems: string[] = [];
    const check = async (label: string, text: string) => {
      const { rows } = await db.query(text);
      if (rows.length) problems.push(`${label}: ${JSON.stringify(rows.slice(0, 5))}`);
    };
    await check(
      'journals that do not sum to zero',
      `select journal_id, sum(amount) as total from postings group by journal_id having sum(amount) <> 0`,
    );
    await check(
      'accounts whose balance is not the sum of their postings',
      `select a.key, a.balance, coalesce(sum(p.amount), 0) as posted from ledger_accounts a
        left join postings p on p.account_id = a.id
        where a.owner_id is not null group by a.id
        having a.balance <> case a.normal when 'debit' then coalesce(sum(p.amount), 0) else -coalesce(sum(p.amount), 0) end`,
    );
    await check(
      'accounts below zero',
      `select key, balance from ledger_accounts where owner_id is not null and balance < 0`,
    );
    await check(
      'escrows left on errands that hold no money (waiting, or finished)',
      `select a.key, a.balance, e.status from ledger_accounts a join errands e on e.id = a.owner_id
        where a.type in ('fee_escrow', 'item_escrow')
        and e.status in ('requested', 'completed', 'cancelled', 'expired')
        and a.balance <> 0`,
    );
    if (problems.length) throw new Error(`Ledger invariants broken:\n${problems.join('\n')}`);
  } finally {
    await db.end();
  }
});
