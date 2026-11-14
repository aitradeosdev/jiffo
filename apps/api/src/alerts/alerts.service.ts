import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { DB, type Db } from '../db/database.module';
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

/**
 * Things finance or the team must look at. Raising one that is already open does nothing, so a check that
 * runs every few minutes leaves one alert, not a pile. Each is also logged as an error for the log alerts.
 */
@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);

  constructor(@Inject(DB) private readonly db: Db) {}

  async raise(input: AlertInput) {
    const [row] = await this.db
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
      this.logger.error(`Alert ${input.kind} in ${input.countryCode}: ${input.message}`);
      return row;
    }
    // Already open: it shows the latest news, e.g. how far below zero revenue is now.
    const [open] = await this.db
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

  async list(countryCode: string, limit = 100) {
    return this.db
      .select()
      .from(alerts)
      .where(eq(alerts.countryCode, countryCode))
      .orderBy(sql`${alerts.resolvedAt} is not null`, desc(alerts.createdAt))
      .limit(limit);
  }

  async openCount(countryCode: string) {
    const [row] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(alerts)
      .where(and(eq(alerts.countryCode, countryCode), isNull(alerts.resolvedAt)));
    return row?.n ?? 0;
  }
}
