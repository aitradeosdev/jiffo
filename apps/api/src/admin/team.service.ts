import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, ne } from 'drizzle-orm';
import { DB, type Db, type Tx } from '../db/database.module';
import { admins, type AdminRole } from '../db/schema';
import { conflict, forbidden, notFound, unavailable } from '../common/errors';
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

  /**
   * Adds a teammate and emails them their link. The email goes after the save, so no locks are held while a
   * provider answers; if it can't go, the invite is taken back and can simply be made again.
   */
  async invite(by: AdminContext, input: { email: string; name: string; role: AdminRole }) {
    const email = this.mail.ready();
    const made = await this.db.transaction(async (tx) => {
      const made = await this.auth.addAdmin(tx, { ...input, invitedBy: by.adminId });
      await this.audit.record(tx, by, {
        action: 'team.invite',
        targetType: 'admin',
        targetId: made.id,
        data: { email: made.email, role: input.role },
      });
      return made;
    });
    const sent = await this.mail.invite(email, {
      to: made.email,
      name: made.name,
      role: input.role,
      by: by.name,
      url: made.inviteUrl,
      hours: made.expiresInHours,
    });
    if (!sent) {
      await this.db.transaction(async (tx) => {
        if (await this.auth.withdrawInvite(tx, made.id, made.tokenHash)) {
          await this.audit.record(tx, by, {
            action: 'team.invite_withdrawn',
            targetType: 'admin',
            targetId: made.id,
            data: { email: made.email, why: 'email_failed' },
          });
        }
      });
      throw unavailable(
        'email_failed',
        "The invite email couldn't be sent, so the invite wasn't kept. Try again, or test the email provider under Settings, Providers.",
      );
    }
    return { id: made.id, emailedTo: made.email, expiresInHours: made.expiresInHours };
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
   * owner who resets never sees it. The email goes after the save, so no locks are held while it's sent.
   */
  async reset(by: AdminContext, id: string) {
    if (id === by.adminId) throw forbidden('own_account', "You can't reset your own access. Ask another owner.");
    const email = this.mail.ready();
    const done = await this.db.transaction(async (tx) => {
      const target = await this.lockTarget(tx, id);
      if (target.role === 'owner' && target.status === 'active') await this.assertAnotherOwner(tx, id);
      const invite = await this.auth.resetAccess(tx, id);
      await this.audit.record(tx, by, { action: 'team.reset', targetType: 'admin', targetId: id });
      return { target, invite };
    });
    const sent = await this.mail.reset(email, {
      to: done.target.email,
      name: done.target.name,
      by: by.name,
      url: done.invite.inviteUrl,
      hours: done.invite.expiresInHours,
    });
    if (!sent) {
      throw unavailable(
        'email_failed',
        "Their access was reset, but the email with their new link couldn't be sent. Reset them again once email works.",
      );
    }
    return { id, emailedTo: done.target.email, expiresInHours: done.invite.expiresInHours };
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
