import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, notInArray, sql, type SQL } from 'drizzle-orm';
import { DB, type Db, type Tx } from '../db/database.module';
import { alerts } from '../db/schema';

export interface AlertInput {
  countryCode: string;
  /** What it is about, e.g. reconciliation_gap or low_provider_balance. */
  kind: string;
  message: string;
  /** Tells apart open alerts of one kind, e.g. the payout an unclear transfer is about. */
  dedupeKey?: string;
  data?: Record<string, unknown>;
}

/** Which kinds of alert a list is for. */
export interface Kinds {
  only?: readonly string[];
  except?: readonly string[];
}
const kindsWhere = (kinds: Kinds): SQL | undefined =>
  and(
    kinds.only ? inArray(alerts.kind, [...kinds.only]) : undefined,
    kinds.except?.length ? notInArray(alerts.kind, [...kinds.except]) : undefined,
  );

/**
 * Things finance or the team must look at. Raising one that is already open does nothing, so a check that
 * runs every few minutes leaves one alert, not a pile. Each is also logged as an error for the log alerts.
 */
@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);

  constructor(@Inject(DB) private readonly db: Db) {}

  /** Raised through `db`: the caller's transaction, so the alert stands only if what raised it does. */
  async raise(input: AlertInput, db: Db | Tx = this.db) {
    const [row] = await db
      .insert(alerts)
      .values({
        countryCode: input.countryCode,
        kind: input.kind,
        dedupeKey: input.dedupeKey ?? '',
        message: input.message,
        data: input.data ?? {},
      })
      .onConflictDoNothing({
        target: [alerts.kind, alerts.countryCode, alerts.dedupeKey],
        where: sql`resolved_at is null`,
      })
      .returning();
    if (row) {
      // One raised in the caller's transaction may yet be undone with it: it isn't logged, which would page for
      // something that didn't happen. Those are read in the panel.
      if (db === this.db) this.logger.error(`Alert ${input.kind} in ${input.countryCode}: ${input.message}`);
      return row;
    }
    // Already open: it shows the latest news, e.g. how far below zero revenue is now.
    const [open] = await db
      .update(alerts)
      .set({ message: input.message, data: input.data ?? {} })
      .where(
        and(
          eq(alerts.countryCode, input.countryCode),
          eq(alerts.kind, input.kind),
          eq(alerts.dedupeKey, input.dedupeKey ?? ''),
          isNull(alerts.resolvedAt),
        ),
      )
      .returning();
    return open ?? null;
  }

  /** Closes the open alert of a kind once its cause has gone, e.g. the provider balance is back up. */
  /**
   * Raises an alert only if none of its kind and key was ever raised, open or resolved: for a daily alert,
   * resolving it doesn't bring it straight back the same day.
   */
  async raiseOnce(input: AlertInput) {
    const [seen] = await this.db
      .select({ id: alerts.id })
      .from(alerts)
      .where(
        and(
          eq(alerts.countryCode, input.countryCode),
          eq(alerts.kind, input.kind),
          eq(alerts.dedupeKey, input.dedupeKey ?? ''),
        ),
      )
      .limit(1);
    if (!seen) await this.raise(input);
  }

  async settle(countryCode: string, kind: string, dedupeKey = '', note = 'Resolved by itself') {
    await this.db
      .update(alerts)
      .set({ resolvedAt: new Date(), resolveNote: note })
      .where(
        and(
          eq(alerts.countryCode, countryCode),
          eq(alerts.kind, kind),
          eq(alerts.dedupeKey, dedupeKey),
          isNull(alerts.resolvedAt),
        ),
      );
  }

  /** Open ones first, then the latest: only the kinds given, or all but those left out. */
  async list(countryCode: string, kinds: Kinds = {}, limit = 100) {
    return this.db
      .select()
      .from(alerts)
      .where(and(eq(alerts.countryCode, countryCode), kindsWhere(kinds)))
      .orderBy(sql`${alerts.resolvedAt} is not null`, desc(alerts.createdAt))
      .limit(limit);
  }

  async openCount(countryCode: string, kinds: Kinds = {}) {
    const [row] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(alerts)
      .where(and(eq(alerts.countryCode, countryCode), isNull(alerts.resolvedAt), kindsWhere(kinds)));
    return row?.n ?? 0;
  }
}
