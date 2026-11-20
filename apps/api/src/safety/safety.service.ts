import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, gt, sql } from 'drizzle-orm';
import { AlertsService } from '../alerts/alerts.service';
import { notFound } from '../common/errors';
import { CountriesService } from '../countries/countries.service';
import { DB, type Db } from '../db/database.module';
import { errands, safetyEvents } from '../db/schema';
import type { AuthContext } from '../auth/auth.types';

/** Presses this close together are one emergency: a person pressing again, or the app sending it again. */
const SAME_EMERGENCY_MS = 30 * 60_000;
/** How long after the latest press the app may keep sending where the person is. */
const FOLLOW_FOR_MS = 30 * 60_000;
/** The positions kept with one emergency, the latest. */
const POSITIONS_KEPT = 300;

export interface Position {
  lat: number;
  lng: number;
  accuracy?: number;
}

/**
 * Emergencies pressed in the apps (docs/security-plan.md, E9). The app dials the country's emergency number
 * from the phone at once; this keeps Jiffo's record of who pressed, on which errand and where they were, and
 * follows where they go for a while, for the safety team's queue.
 */
@Injectable()
export class SafetyService {
  private readonly logger = new Logger(SafetyService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly countries: CountriesService,
    private readonly alerts: AlertsService,
  ) {}

  /**
   * A press, never refused: an errand that isn't the person's own is left off rather than turning them away.
   * Presses within half an hour of the latest are one emergency (a double tap, or the app sending it again):
   * they add where the person is, and the errand if the first press had none. One at a time per person.
   */
  async press(auth: AuthContext, input: Partial<Position> & { errandId?: string }) {
    const errandId = input.errandId ? await this.ownErrand(auth.userId, input.errandId) : null;
    const { settings } = await this.countries.currentSettings(auth.countryCode);
    const emergencyNumber = settings.safety.emergencyNumber;
    const located = input.lat !== undefined && input.lng !== undefined;
    const { id, created } = await this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'emergency:' + auth.userId}))`);
      const [recent] = await tx
        .select({ id: safetyEvents.id, errandId: safetyEvents.errandId })
        .from(safetyEvents)
        .where(
          and(
            eq(safetyEvents.userId, auth.userId),
            eq(safetyEvents.status, 'open'),
            gt(safetyEvents.lastPressedAt, new Date(Date.now() - SAME_EMERGENCY_MS)),
          ),
        )
        .orderBy(desc(safetyEvents.lastPressedAt))
        .limit(1);
      if (recent) {
        await tx
          .update(safetyEvents)
          .set({
            lastPressedAt: new Date(),
            updatedAt: new Date(),
            ...(!recent.errandId && errandId ? { errandId } : {}),
          })
          .where(eq(safetyEvents.id, recent.id));
        return { id: recent.id, created: false };
      }
      const [made] = await tx
        .insert(safetyEvents)
        .values({
          countryCode: auth.countryCode,
          userId: auth.userId,
          app: auth.app,
          errandId,
          lat: located ? input.lat! : null,
          lng: located ? input.lng! : null,
          accuracy: located ? (input.accuracy ?? null) : null,
        })
        .returning({ id: safetyEvents.id });
      return { id: made!.id, created: true };
    });
    if (!created && located) {
      await this.follow(auth, id, { lat: input.lat!, lng: input.lng!, accuracy: input.accuracy });
    }
    if (created) {
      this.logger.error(`Emergency ${id} pressed in the ${auth.app} app`);
      await this.alerts
        .raise({
          countryCode: auth.countryCode,
          kind: 'emergency',
          dedupeKey: id,
          message: `Someone pressed the emergency button in the ${auth.app} app. See the Safety queue.`,
          data: { emergencyId: id, errandId },
        })
        .catch((error: Error) => this.logger.error(`Raising the alert for emergency ${id} failed: ${error.message}`));
    }
    return { id, emergencyNumber };
  }

  /** The errand, if it is the person's own; else none. */
  private async ownErrand(userId: string, errandId: string) {
    const [errand] = await this.db
      .select({ customerId: errands.customerId, agentId: errands.agentId })
      .from(errands)
      .where(eq(errands.id, errandId));
    return errand && (errand.customerId === userId || errand.agentId === userId) ? errandId : null;
  }

  /** Where the person is now, sent by the app for a while after the press. Theirs only. */
  async follow(auth: AuthContext, id: string, position: Position) {
    const point = {
      lat: position.lat,
      lng: position.lng,
      accuracy: position.accuracy ?? null,
      at: new Date().toISOString(),
    };
    const updated = await this.db
      .update(safetyEvents)
      .set({
        // The latest few hundred, so a phone left sending can't grow it without end.
        positions: sql`(select coalesce(jsonb_agg(p order by n), '[]'::jsonb) from (
            select p, n from jsonb_array_elements(${safetyEvents.positions} || ${JSON.stringify([point])}::jsonb)
              with ordinality as e(p, n)
            order by n desc limit ${POSITIONS_KEPT}) kept)`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(safetyEvents.id, id),
          eq(safetyEvents.userId, auth.userId),
          gt(safetyEvents.lastPressedAt, new Date(Date.now() - FOLLOW_FOR_MS)),
        ),
      )
      .returning({ id: safetyEvents.id });
    if (!updated.length) throw notFound('emergency_not_found', 'Emergency not found');
  }
}
