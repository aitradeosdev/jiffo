import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, lt } from 'drizzle-orm';
import { DB, type Db, type Tx } from '../db/database.module';
import { adminAudit, admins, errands, users } from '../db/schema';
import type { AdminContext } from './admin.types';

export interface AuditEntry {
  action: string;
  targetType?: string;
  targetId?: string;
  countryCode?: string;
  data?: Record<string, unknown>;
}

/** The record of what admins changed. Write it in the same transaction as the change. */
@Injectable()
export class AuditService {
  constructor(@Inject(DB) private readonly db: Db) {}

  record(tx: Tx, admin: AdminContext, entry: AuditEntry) {
    return tx.insert(adminAudit).values({
      adminId: admin.adminId,
      action: entry.action,
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      countryCode: entry.countryCode ?? null,
      // A change that waited for approval says which request it was and who approved it.
      data: admin.approval ? { ...(entry.data ?? {}), approval: admin.approval } : (entry.data ?? {}),
      ip: admin.ip,
    });
  }

  /** Newest first. Pass the last id of a page as `before` for the next one. */
  async list(query: { before?: number; limit: number; targetType?: string; targetId?: string }) {
    const rows = await this.db
      .select({
        id: adminAudit.id,
        action: adminAudit.action,
        targetType: adminAudit.targetType,
        targetId: adminAudit.targetId,
        countryCode: adminAudit.countryCode,
        data: adminAudit.data,
        ip: adminAudit.ip,
        createdAt: adminAudit.createdAt,
        admin: { id: admins.id, name: admins.name, email: admins.email },
      })
      .from(adminAudit)
      .innerJoin(admins, eq(admins.id, adminAudit.adminId))
      .where(
        and(
          query.before ? lt(adminAudit.id, query.before) : undefined,
          query.targetType ? eq(adminAudit.targetType, query.targetType) : undefined,
          query.targetId ? eq(adminAudit.targetId, query.targetId) : undefined,
        ),
      )
      .orderBy(desc(adminAudit.id))
      .limit(query.limit + 1);
    const entries = rows.slice(0, query.limit);
    // What each entry was about, by name, so the log reads without opening every target.
    const ids = (type: string) => [
      ...new Set(entries.filter((e) => e.targetType === type && e.targetId).map((e) => e.targetId!)),
    ];
    const [people, errandRows, team] = await Promise.all([
      ids('person').length
        ? this.db
            .select({ id: users.id, firstName: users.firstName, lastName: users.lastName, phone: users.phone })
            .from(users)
            .where(inArray(users.id, ids('person')))
        : [],
      ids('errand').length
        ? this.db
            .select({ id: errands.id, description: errands.description })
            .from(errands)
            .where(inArray(errands.id, ids('errand')))
        : [],
      ids('admin').length
        ? this.db
            .select({ id: admins.id, name: admins.name })
            .from(admins)
            .where(inArray(admins.id, ids('admin')))
        : [],
    ]);
    const label = new Map<string, string>([
      ...people.map((p) => [p.id, [p.firstName, p.lastName].filter(Boolean).join(' ') || p.phone] as const),
      ...errandRows.map((e) => [e.id, e.description] as const),
      ...team.map((a) => [a.id, a.name] as const),
    ]);
    return {
      entries: entries.map((e) => ({ ...e, targetLabel: e.targetId ? (label.get(e.targetId) ?? null) : null })),
      more: rows.length > query.limit,
    };
  }
}
