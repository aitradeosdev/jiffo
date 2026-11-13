import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, lt } from 'drizzle-orm';
import { DB, type Db, type Tx } from '../db/database.module';
import { adminAudit, admins } from '../db/schema';
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
      data: entry.data ?? {},
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
    return { entries: rows.slice(0, query.limit), more: rows.length > query.limit };
  }
}
