import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { WITHDRAWAL_HOLD_INFO, type WithdrawalHoldReason } from '@jiffo/shared';
import { MESSAGING, type MessagingAdapter } from '../adapters/messaging';
import { CountriesService } from '../countries/countries.service';
import { DB, type Db, type Tx } from '../db/database.module';
import { users } from '../db/schema';
import { ProvidersService } from '../providers/providers.service';
import { PushService } from '../push/push.service';

const HOUR_MS = 3_600_000;

/**
 * The hold on an agent's withdrawals after a change to their account (docs/security-plan.md, A6, P8, X4): a
 * new payout account, or a sign-in on a new phone. Whoever takes over a number or an account can't move the
 * money out before the owner hears about it, by push, SMS and email, and acts.
 */
@Injectable()
export class WithdrawalHoldsService {
  private readonly logger = new Logger('WithdrawalHolds');

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly countries: CountriesService,
    private readonly push: PushService,
    private readonly providers: ProvidersService,
    @Inject(MESSAGING) private readonly sms: MessagingAdapter,
  ) {}

  /**
   * Starts a hold, in the caller's transaction, for the hours set in Settings, Security. A hold already
   * running longer is kept: a change never shortens one. Gives when it ends.
   */
  async start(tx: Tx, userId: string, reason: WithdrawalHoldReason): Promise<Date> {
    const [user] = await tx
      .select({ countryCode: users.countryCode, until: users.withdrawalsHeldUntil })
      .from(users)
      .where(eq(users.id, userId))
      .for('update');
    if (!user) throw new Error(`No user ${userId}`);
    const { settings } = await this.countries.currentSettings(user.countryCode);
    const until = new Date(Date.now() + settings.security.withdrawalHoldHours * HOUR_MS);
    if (user.until && user.until >= until) return user.until;
    await tx.update(users).set({ withdrawalsHeldUntil: until, withdrawalsHeldFor: reason }).where(eq(users.id, userId));
    return until;
  }

  /** The hold on someone's withdrawals now, if there is one. */
  async current(userId: string, db: Db | Tx = this.db) {
    const [user] = await db
      .select({ until: users.withdrawalsHeldUntil, reason: users.withdrawalsHeldFor })
      .from(users)
      .where(eq(users.id, userId));
    return user?.until && user.until > new Date() ? { until: user.until, reason: user.reason } : null;
  }

  /**
   * Tells the agent, once the change is saved, everywhere they might see it: push, SMS and email (A6). A
   * notice that can't go never undoes the change or the hold.
   */
  async tell(userId: string, reason: WithdrawalHoldReason, until: Date, options: { push?: boolean } = {}) {
    const [user] = await this.db
      .select({ phone: users.phone, email: users.email, countryCode: users.countryCode })
      .from(users)
      .where(eq(users.id, userId));
    if (!user) return;
    const { timezone } = await this.countries.basics(user.countryCode);
    const hours = Math.max(1, Math.round((until.getTime() - Date.now()) / HOUR_MS));
    const when = until.toLocaleString('en-GB', {
      timeZone: timezone,
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
    });
    const because = WITHDRAWAL_HOLD_INFO[reason].because;
    const what = `Withdrawals are paused for ${hours} hours, until ${when}, because ${because}.`;
    const ifNotYou = "If this wasn't you, contact Jiffo support now.";
    const sent = await Promise.allSettled([
      // A change with its own push (a new payout account) says it there instead, so it comes once.
      options.push === false
        ? Promise.resolve()
        : this.push.notifyUser(userId, 'agent', {
            title: 'Withdrawals paused',
            body: `${what} ${ifNotYou}`,
            data: { type: 'wallet.hold' },
          }),
      this.sms.sendText(user.phone, `Jiffo: ${what} ${ifNotYou}`),
      user.email
        ? this.providers.current('email').send({
            to: user.email,
            subject: 'Your Jiffo withdrawals are paused',
            text: `${what}\n\nThis keeps your earnings safe if someone else has your phone number or account. You can keep working as usual, and your earnings stay in your balance.\n\n${ifNotYou}`,
          })
        : Promise.resolve(),
    ]);
    for (const result of sent) {
      if (result.status === 'rejected') {
        this.logger.warn(`A withdrawal hold notice didn't go: ${(result.reason as Error)?.message ?? result.reason}`);
      }
    }
  }
}
