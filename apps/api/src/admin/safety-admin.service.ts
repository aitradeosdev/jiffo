import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { AlertsService } from '../alerts/alerts.service';
import { conflict, notFound } from '../common/errors';
import { DB, type Db } from '../db/database.module';
import { admins, errands, safetyEvents, users } from '../db/schema';
import type { AdminContext } from './admin.types';
import { AuditService } from './audit.service';
import { requireCountry } from './countries';

/**
 * The Safety queue (docs/security-plan.md, E9): emergencies pressed in the apps, with who, which errand and
 * where, for the safety team to follow up and close with what they did.
 */
@Injectable()
export class SafetyAdminService {
  private readonly logger = new Logger(SafetyAdminService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly alerts: AlertsService,
    private readonly audit: AuditService,
  ) {}

  async counts(country: string) {
    await requireCountry(this.db, country);
    const rows = await this.db
      .select({ status: safetyEvents.status, n: sql<number>`count(*)::int` })
      .from(safetyEvents)
      .where(eq(safetyEvents.countryCode, country))
      .groupBy(safetyEvents.status);
    return {
      open: rows.find((r) => r.status === 'open')?.n ?? 0,
      handled: rows.find((r) => r.status === 'handled')?.n ?? 0,
    };
  }

  /** Open ones oldest first, as a queue is worked; handled ones latest first. */
  async list(query: { country: string; status: 'open' | 'handled'; limit: number }) {
    await requireCountry(this.db, query.country);
    const rows = await this.db
      .select({
        id: safetyEvents.id,
        status: safetyEvents.status,
        app: safetyEvents.app,
        lat: safetyEvents.lat,
        lng: safetyEvents.lng,
        accuracy: safetyEvents.accuracy,
        positions: safetyEvents.positions,
        note: safetyEvents.note,
        createdAt: safetyEvents.createdAt,
        handledAt: safetyEvents.handledAt,
        handledBy: admins.name,
        person: {
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
          phone: users.phone,
        },
        errandId: safetyEvents.errandId,
        errandStatus: errands.status,
        errandDescription: errands.description,
      })
      .from(safetyEvents)
      .innerJoin(users, eq(users.id, safetyEvents.userId))
      .leftJoin(errands, eq(errands.id, safetyEvents.errandId))
      .leftJoin(admins, eq(admins.id, safetyEvents.handledBy))
      .where(and(eq(safetyEvents.countryCode, query.country), eq(safetyEvents.status, query.status)))
      .orderBy(query.status === 'open' ? safetyEvents.createdAt : desc(safetyEvents.handledAt))
      .limit(query.limit);
    return {
      emergencies: rows.map(({ errandId, errandStatus, errandDescription, ...r }) => ({
        ...r,
        errand: errandId ? { id: errandId, status: errandStatus, description: errandDescription } : null,
      })),
    };
  }

  /** The safety team followed it up: what they did, in the audit log. Once. */
  async handle(admin: AdminContext, id: string, note: string) {
    const out = await this.db.transaction(async (tx) => {
      const [event] = await tx.select().from(safetyEvents).where(eq(safetyEvents.id, id)).for('update');
      if (!event) throw notFound('emergency_not_found', 'Emergency not found');
      if (event.status !== 'open') throw conflict('already_handled', 'This emergency was already handled');
      await this.audit.record(tx, admin, {
        action: 'safety.handle',
        targetType: 'safety',
        targetId: id,
        countryCode: event.countryCode,
        data: { note, errandId: event.errandId },
      });
      const [after] = await tx
        .update(safetyEvents)
        .set({ status: 'handled', handledBy: admin.adminId, handledAt: new Date(), note, updatedAt: new Date() })
        .where(eq(safetyEvents.id, id))
        .returning({ id: safetyEvents.id, status: safetyEvents.status, countryCode: safetyEvents.countryCode });
      return after!;
    });
    // The emergency is handled whatever happens to its alert: a settle that fails is logged, not the handling.
    await this.alerts
      .settle(out.countryCode, 'emergency', id, `Handled: ${note}`)
      .catch((error: Error) => this.logger.error(`Settling the alert for emergency ${id} failed: ${error.message}`));
    return { id: out.id, status: out.status };
  }
}
