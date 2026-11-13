import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, ne } from 'drizzle-orm';
import { DB, type Db, type Tx } from '../db/database.module';
import { admins, type AdminRole } from '../db/schema';
import { conflict, forbidden, notFound } from '../common/errors';
import { AdminAuthService, normaliseEmail } from './admin-auth.service';
import { AuditService } from './audit.service';
import type { AdminContext } from './admin.types';

/** The admin team: invites, roles, disabling and resetting access. Owners only. */
@Injectable()
export class TeamService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly auth: AdminAuthService,
    private readonly audit: AuditService,
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
    const email = normaliseEmail(input.email);
    return this.db.transaction(async (tx) => {
      const [existing] = await tx.select({ id: admins.id }).from(admins).where(eq(admins.email, email));
      if (existing) throw conflict('admin_exists', 'Someone on the team already uses this email');
      const [admin] = await tx
        .insert(admins)
        .values({ email, name: input.name.trim(), role: input.role, invitedBy: by.adminId })
        .returning({ id: admins.id });
      const invite = await this.auth.issueInvite(tx, admin!.id);
      await this.audit.record(tx, by, {
        action: 'team.invite',
        targetType: 'admin',
        targetId: admin!.id,
        data: { email, role: input.role },
      });
      return { id: admin!.id, ...invite };
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

  /** For a lost phone or password: clears both, ends their sessions and makes a new invite link. */
  async reset(by: AdminContext, id: string) {
    if (id === by.adminId) throw forbidden('own_account', "You can't reset your own access. Ask another owner.");
    return this.db.transaction(async (tx) => {
      const target = await this.lockTarget(tx, id);
      if (target.status === 'disabled') throw conflict('admin_disabled', 'Enable this teammate first');
      if (target.role === 'owner' && target.status === 'active') await this.assertAnotherOwner(tx, id);
      await tx
        .update(admins)
        .set({
          status: 'invited',
          passwordHash: null,
          totpCipher: null,
          totpEnabledAt: null,
          totpLastStep: null,
          updatedAt: new Date(),
        })
        .where(eq(admins.id, id));
      await this.auth.revokeAll(tx, id, 'reset');
      const invite = await this.auth.issueInvite(tx, id);
      await this.audit.record(tx, by, { action: 'team.reset', targetType: 'admin', targetId: id });
      return invite;
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
