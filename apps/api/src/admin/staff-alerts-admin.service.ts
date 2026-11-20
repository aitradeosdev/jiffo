import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { STAFF_ALERT_KINDS } from '@jiffo/shared';
import { AlertsService } from '../alerts/alerts.service';
import { forbidden, notFound } from '../common/errors';
import { DB, type Db } from '../db/database.module';
import { alerts } from '../db/schema';
import type { AdminContext } from './admin.types';
import { AuditService } from './audit.service';

const KINDS: ReadonlySet<string> = new Set(STAFF_ALERT_KINDS);

/**
 * Alerts about staff, for owners (docs/security-plan.md, D8): listed and closed on the Audit log page, never
 * by the staff member they are about.
 */
@Injectable()
export class StaffAlertsAdminService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly alerts: AlertsService,
    private readonly audit: AuditService,
  ) {}

  async list(country: string) {
    const rows = await this.alerts.list(country, { only: STAFF_ALERT_KINDS });
    return {
      alerts: rows.map((a) => ({
        id: a.id,
        kind: a.kind,
        message: a.message,
        data: a.data,
        createdAt: a.createdAt,
        resolvedAt: a.resolvedAt,
        resolveNote: a.resolveNote,
      })),
    };
  }

  async resolve(admin: AdminContext, id: string, note: string) {
    return this.db.transaction(async (tx) => {
      const [open] = await tx
        .select()
        .from(alerts)
        .where(and(eq(alerts.id, id), isNull(alerts.resolvedAt)))
        .for('update');
      if (!open || !KINDS.has(open.kind)) throw notFound('alert_not_found', 'No open alert about staff with that id');
      const about = (open.data as { adminId?: string; staffId?: string }) ?? {};
      if (about.adminId === admin.adminId || about.staffId === admin.adminId) {
        throw forbidden('own_alert', 'This alert is about you: another owner closes it');
      }
      await tx
        .update(alerts)
        .set({ resolvedAt: new Date(), resolvedBy: admin.adminId, resolveNote: note })
        .where(eq(alerts.id, id));
      await this.audit.record(tx, admin, {
        action: 'alert.resolve',
        targetType: 'alert',
        targetId: id,
        countryCode: open.countryCode ?? undefined,
        data: { kind: open.kind, note },
      });
      return { resolved: true };
    });
  }
}
