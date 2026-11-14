import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, ne } from 'drizzle-orm';
import { DB, type Db, type Tx } from '../db/database.module';
import { admins, type AdminRole } from '../db/schema';
import { conflict, forbidden, notFound } from '../common/errors';
import { AdminAuthService } from './admin-auth.service';
import { AuditService } from './audit.service';
import { StaffMail } from './staff-mail';
import type { AdminContext } from './admin.types';

/** The admin team: invites, roles, disabling and resetting access. Owners only. */
@Injectable()
export class TeamService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly auth: AdminAuthService,
    private readonly audit: AuditService,
    private readonly mail: StaffMail,
  ) {}

  async list() {
    const rows = await this.db
      .select({
        id: admins.id,
        email: admins.email,
        name: admins.name,
        role: admins.role,
        status: admins.status,
        totpEnabledAt: admins.totpEnabledAt,
        inviteExpiresAt: admins.inviteExpiresAt,
        lastSignInAt: admins.lastSignInAt,
        createdAt: admins.createdAt,
      })
      .from(admins)
      .orderBy(asc(admins.createdAt));
    return rows.map(({ totpEnabledAt, inviteExpiresAt, ...a }) => ({
      ...a,
      twoStep: !!totpEnabledAt,
      inviteExpired: a.status === 'invited' && (!inviteExpiresAt || inviteExpiresAt.getTime() <= Date.now()),
    }));
  }

  async invite(by: AdminContext, input: { email: string; name: string; role: AdminRole }) {
    return this.db.transaction(async (tx) => {
      const { id, email, inviteUrl, expiresInHours } = await this.auth.addAdmin(tx, {
        ...input,
        invitedBy: by.adminId,
      });
      await this.audit.record(tx, by, {
        action: 'team.invite',
        targetType: 'admin',
        targetId: id,
        data: { email, role: input.role },
      });
      // Last, inside the transaction: if the email can't go, the invite isn't kept and the panel says why.
      await this.mail.invite({
        to: email,
        name: input.name.trim(),
        role: input.role,
        by: by.name,
        url: inviteUrl,
        hours: expiresInHours,
      });
      return { id, emailedTo: email, expiresInHours };
    });
  }

  /** Changes a teammate's role, or disables or re-enables them. Not for your own account. */
  async update(by: AdminContext, id: string, change: { role?: AdminRole; status?: 'active' | 'disabled' }) {
    if (id === by.adminId) throw forbidden('own_account', "You can't change your own access. Ask another owner.");
    return this.db.transaction(async (tx) => {
      const target = await this.lockTarget(tx, id);
      const role = change.role ?? target.role;
      let status = target.status;
      if (change.status === 'disabled') status = 'disabled';
      // Re-enabled: back to where they were, which is still invited if they never set a password.
      if (change.status === 'active' && target.status === 'disabled')
        status = target.passwordHash ? 'active' : 'invited';

      const losesOwner =
        target.role === 'owner' && target.status === 'active' && (role !== 'owner' || status !== 'active');
      if (losesOwner) await this.assertAnotherOwner(tx, id);

      await tx.update(admins).set({ role, status, updatedAt: new Date() }).where(eq(admins.id, id));
      if (status === 'disabled' || role !== target.role)
        await this.auth.revokeAll(tx, id, status === 'disabled' ? 'disabled' : 'role_changed');
      await this.audit.record(tx, by, {
        action: 'team.update',
        targetType: 'admin',
        targetId: id,
        data: { from: { role: target.role, status: target.status }, to: { role, status } },
      });
      return { id, role, status };
    });
  }

  /**
   * For a lost phone or password: clears both, ends their sessions and emails the teammate a new link. The
   * owner who resets never sees it.
   */
  async reset(by: AdminContext, id: string) {
    if (id === by.adminId) throw forbidden('own_account', "You can't reset your own access. Ask another owner.");
    return this.db.transaction(async (tx) => {
      const target = await this.lockTarget(tx, id);
      if (target.role === 'owner' && target.status === 'active') await this.assertAnotherOwner(tx, id);
      const { inviteUrl, expiresInHours } = await this.auth.resetAccess(tx, id);
      await this.audit.record(tx, by, { action: 'team.reset', targetType: 'admin', targetId: id });
      await this.mail.reset({
        to: target.email,
        name: target.name,
        by: by.name,
        url: inviteUrl,
        hours: expiresInHours,
      });
      return { id, emailedTo: target.email, expiresInHours };
    });
  }

  private async lockTarget(tx: Tx, id: string) {
    const [target] = await tx.select().from(admins).where(eq(admins.id, id)).for('update');
    if (!target) throw notFound('admin_not_found', 'Teammate not found');
    return target;
  }

  /** There must always be an active owner, or nobody could manage the team. */
  private async assertAnotherOwner(tx: Tx, exceptId: string) {
    // Locks the owners, so two owners can't each remove the other at the same moment.
    const owners = await tx
      .select({ id: admins.id })
      .from(admins)
      .where(and(eq(admins.role, 'owner'), eq(admins.status, 'active'), ne(admins.id, exceptId)))
      .for('update');
    if (owners.length === 0) throw conflict('last_owner', 'There must always be at least one active owner');
  }
}
