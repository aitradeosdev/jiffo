import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DB, type Db } from './tokens';
import { isSealed, nameIndex, openField, sealField } from './fields';

/** Each table with encrypted columns: its key, the columns, and what is worked out from them. */
const TABLES = [
  {
    table: 'agent_applications',
    key: 'user_id',
    columns: ['legal_name', 'date_of_birth', 'address', 'emergency_name', 'emergency_phone', 'emergency_relationship'],
    index: true,
    last4: false,
  },
  {
    table: 'customer_verifications',
    key: 'user_id',
    columns: ['legal_name', 'date_of_birth'],
    index: true,
    last4: false,
  },
  {
    table: 'payout_accounts',
    key: 'id',
    columns: ['account_number', 'account_name', 'recipient_code'],
    index: false,
    last4: true,
  },
] as const;
const BATCH = 200;

/**
 * Encrypts personal details saved before they were encrypted, and fills in what is worked out from them (the
 * name search index, an account's last four digits). Runs once in the background when a server starts. Each
 * row is changed only if it still holds what was read, so a write made meanwhile is never undone.
 */
@Injectable()
export class FieldsBackfill implements OnApplicationBootstrap {
  private readonly logger = new Logger('FieldsBackfill');

  constructor(@Inject(DB) private readonly db: Db) {}

  onApplicationBootstrap() {
    void this.run().catch((error: unknown) => this.logger.error(`Encrypting older rows failed: ${String(error)}`));
  }

  /**
   * Walks each table once in key order, so every row is looked at once per run. A row that can't be read (a
   * value sealed under another key, say) is logged and left as it is, and the rest go on.
   */
  async run() {
    let done = 0;
    let skipped = 0;
    for (const t of TABLES) {
      const plain = t.columns.map((c) => `(${c} is not null and ${c} not like 'enc:%')`);
      const missing = [
        ...(t.index ? [`(legal_name is not null and legal_name_index is null)`] : []),
        ...(t.last4 ? [`(account_number is not null and account_last4 is null)`] : []),
      ];
      const extra = [...(t.index ? ['legal_name_index'] : []), ...(t.last4 ? ['account_last4'] : [])];
      let after: string | null = null;
      for (;;) {
        const { rows }: { rows: Array<Record<string, string | string[] | null>> } = await this.db.execute(
          sql`select ${sql.raw([t.key, ...t.columns, ...extra].join(', '))} from ${sql.identifier(t.table)}
              where (${sql.raw([...plain, ...missing].join(' or '))})
                ${after === null ? sql`` : sql`and ${sql.identifier(t.key)} > ${after}`}
              order by ${sql.identifier(t.key)} limit ${BATCH}`,
        );
        for (const row of rows) {
          try {
            done += await this.encrypt(t, extra, row);
          } catch (error) {
            skipped += 1;
            this.logger.warn(`Could not encrypt ${t.table} ${String(row[t.key])}: ${(error as Error).message}`);
          }
        }
        if (rows.length < BATCH) break;
        after = String(rows[rows.length - 1]![t.key]);
      }
    }
    if (done || skipped)
      this.logger.log(`Encrypted personal details in ${done} older rows; ${skipped} left as they were`);
    return done;
  }

  /** One row: sealed and filled in, if it still holds what was read. Gives 1 when it was changed. */
  private async encrypt(
    t: (typeof TABLES)[number],
    extra: string[],
    row: Record<string, string | string[] | null>,
  ): Promise<number> {
    const set: Record<string, string | string[] | null> = {};
    const value = (c: string) => {
      const raw = row[c] as string | null;
      return raw === null ? null : openField(`${t.table}.${c}`, raw);
    };
    for (const c of t.columns) {
      const raw = row[c] as string | null;
      if (raw !== null && !isSealed(raw)) set[c] = sealField(`${t.table}.${c}`, raw);
    }
    if (t.index && row.legal_name_index === null) set.legal_name_index = nameIndex(value('legal_name'));
    if (t.last4 && row.account_last4 === null) set.account_last4 = value('account_number')?.slice(-4) ?? null;
    if (!Object.keys(set).length) return 0;
    // An index is a list of hex hashes, written as a Postgres array literal.
    const literal = (v: string | string[] | null) => (Array.isArray(v) ? `{${v.join(',')}}` : v);
    const assignments = Object.entries(set).map(([c, v]) =>
      Array.isArray(v) ? sql`${sql.identifier(c)} = ${literal(v)}::text[]` : sql`${sql.identifier(c)} = ${v}`,
    );
    const unchanged = [...t.columns, ...extra].map((c) =>
      Array.isArray(row[c])
        ? sql`${sql.identifier(c)} is not distinct from ${literal(row[c])}::text[]`
        : sql`${sql.identifier(c)} is not distinct from ${row[c]}`,
    );
    const result = await this.db.execute(
      sql`update ${sql.identifier(t.table)} set ${sql.join(assignments, sql`, `)}
          where ${sql.identifier(t.key)} = ${row[t.key]} and ${sql.join(unchanged, sql` and `)}`,
    );
    return result.rowCount ?? 0;
  }
}
