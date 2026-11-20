import { Inject, Injectable } from '@nestjs/common';
import { and, count, eq, gt, inArray, isNull } from 'drizzle-orm';
import { DEFAULT_SECURITY_SETTINGS, type StaffAlertKind } from '@jiffo/shared';
import { AlertsService } from '../alerts/alerts.service';
import { CountriesService } from '../countries/countries.service';
import { DB, type Db, type Tx } from '../db/database.module';
import { adminAudit, admins, alerts, users } from '../db/schema';
import type { AdminContext } from './admin.types';

/** Staff actions that move or decide money, for the out-of-hours alert. */
const MONEY_ACTIONS: ReadonlySet<string> = new Set([
  'money.adjust',
  'money.reconciliation_clear',
  'errand.resolve_complete',
  'errand.resolve_cancel',
]);
/** Requests for a second admin that are about money: asking and approving count as money actions too. */
const MONEY_APPROVALS: ReadonlySet<string> = new Set(['wallet_adjustment', 'dispute_split']);

interface Recorded {
  action: string;
  targetType?: string;
  targetId?: string;
  countryCode?: string;
  data?: Record<string, unknown>;
}

/**
 * Alerts about staff for owners (docs/security-plan.md, D8): a staff member revealing many people's details,
 * or any out of hours; an adjustment to an app account a staff member uses; and money actions out of hours.
 * Checked as each staff action is recorded, in its transaction, so an alert stands only for what was done.
 */
@Injectable()
export class StaffOversightService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly alerts: AlertsService,
    private readonly countries: CountriesService,
  ) {}

  /** After a staff action is in the audit log, in the same transaction. */
  async recorded(tx: Tx, admin: AdminContext, entry: Recorded, people: () => Promise<string[]>) {
    const country = entry.countryCode;
    if (!country) return;
    const kind = typeof entry.data?.kind === 'string' ? entry.data.kind : null;
    const money =
      MONEY_ACTIONS.has(entry.action) ||
      ((entry.action === 'approval.request' || entry.action === 'approval.approve') &&
        !!kind &&
        MONEY_APPROVALS.has(kind));
    const adjustment =
      (entry.action === 'approval.request' && kind === 'wallet_adjustment') ||
      // An adjustment that ran without a request first: none do today, but one would be seen.
      (entry.action === 'money.adjust' && !admin.approval);
    if (entry.action !== 'person.reveal' && !money && !adjustment) return;

    const clock = await this.clock(country);
    if (entry.action === 'person.reveal') await this.reveals(tx, admin, country, clock);
    if (money && clock.outOfHours) await this.outOfHours(tx, admin, country, clock, entry.action);
    if (adjustment) await this.staffAccount(tx, admin, country, entry, await people());
  }

  /**
   * A reveal refused at the day's limit: told to owners outside the refused transaction, which is undone. It
   * updates the day's alert about this staff member's reveals.
   */
  async revealLimit(admin: AdminContext, country: string, limit: number) {
    const clock = await this.clock(country);
    await this.alerts.raise({
      countryCode: country,
      kind: 'unusual_id_reveals' satisfies StaffAlertKind,
      dedupeKey: `${admin.adminId}:${clock.day}`,
      message: `${await this.nameOf(this.db, admin)} reached the daily limit of ${limit} ID reveals, and was refused another`,
      data: { adminId: admin.adminId, count: limit, limit, refused: true },
    });
  }

  private async reveals(tx: Tx, admin: AdminContext, country: string, clock: Clock) {
    const [today] = await tx
      .select({ n: count() })
      .from(adminAudit)
      .where(
        and(
          eq(adminAudit.adminId, admin.adminId),
          eq(adminAudit.action, 'person.reveal'),
          eq(adminAudit.countryCode, country),
          gt(adminAudit.createdAt, new Date(Date.now() - 24 * 3_600_000)),
        ),
      );
    const n = today?.n ?? 0;
    if (n < clock.security.idRevealAlertAt && !clock.outOfHours) return;
    const name = await this.nameOf(tx, admin);
    await this.alerts.raise(
      {
        countryCode: country,
        kind: 'unusual_id_reveals' satisfies StaffAlertKind,
        dedupeKey: `${admin.adminId}:${clock.day}`,
        message:
          n >= clock.security.idRevealAlertAt
            ? `${name} revealed ${n} people's personal details in the last day`
            : `${name} revealed a person's personal details out of hours, at ${clock.time}`,
        data: { adminId: admin.adminId, count: n, outOfHours: clock.outOfHours },
      },
      tx,
    );
  }

  /** One alert a day for each staff member, counting the money actions they took out of hours. */
  private async outOfHours(tx: Tx, admin: AdminContext, country: string, clock: Clock, action: string) {
    const dedupeKey = `${admin.adminId}:${clock.day}`;
    const [open] = await tx
      .select({ data: alerts.data })
      .from(alerts)
      .where(
        and(
          eq(alerts.countryCode, country),
          eq(alerts.kind, 'out_of_hours_money'),
          eq(alerts.dedupeKey, dedupeKey),
          isNull(alerts.resolvedAt),
        ),
      );
    const before = (open?.data ?? {}) as { count?: number; actions?: string[] };
    const n = (before.count ?? 0) + 1;
    await this.alerts.raise(
      {
        countryCode: country,
        kind: 'out_of_hours_money' satisfies StaffAlertKind,
        dedupeKey,
        message: `${await this.nameOf(tx, admin)} took ${n} money action${n === 1 ? '' : 's'} out of hours, the latest at ${clock.time}`,
        data: { adminId: admin.adminId, count: n, actions: [...(before.actions ?? []), action].slice(-20) },
      },
      tx,
    );
  }

  /** An adjustment asked for on an app account whose phone is a staff member's (D3 links them by phone). */
  private async staffAccount(tx: Tx, admin: AdminContext, country: string, entry: Recorded, people: string[]) {
    if (!people.length) return;
    const staff = await tx
      .select({ id: admins.id, name: admins.name, userId: users.id })
      .from(users)
      .innerJoin(admins, eq(admins.phone, users.phone))
      .where(inArray(users.id, people));
    for (const s of staff) {
      await this.alerts.raise(
        {
          countryCode: country,
          kind: 'staff_account_adjustment' satisfies StaffAlertKind,
          dedupeKey: `${entry.targetType}:${entry.targetId}:${s.id}`,
          message: `${await this.nameOf(tx, admin)} asked for an adjustment to the app account of ${s.name}, on the team`,
          data: { adminId: admin.adminId, staffId: s.id, userId: s.userId, approvalId: entry.targetId ?? null },
        },
        tx,
      );
    }
  }

  private async nameOf(db: Db | Tx, admin: AdminContext) {
    const [row] = await db.select({ name: admins.name }).from(admins).where(eq(admins.id, admin.adminId));
    return row?.name ?? 'A staff member';
  }

  /** The country's settings and local time now: the day, the time, and whether it is out of working hours. */
  private async clock(country: string): Promise<Clock> {
    const [current, basics] = await Promise.all([
      this.countries.currentSettingsIfAny(country),
      this.countries.basics(country),
    ]);
    const security = current?.settings.security ?? DEFAULT_SECURITY_SETTINGS;
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-GB', {
        timeZone: basics.timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      })
        .formatToParts(new Date())
        .map((p) => [p.type, p.value]),
    );
    const hour = Number(parts.hour);
    return {
      security,
      day: `${parts.year}-${parts.month}-${parts.day}`,
      time: `${parts.hour}:${parts.minute}`,
      outOfHours: hour < security.staffHoursStart || hour >= security.staffHoursEnd,
    };
  }
}

interface Clock {
  security: typeof DEFAULT_SECURITY_SETTINGS;
  /** The country's own date, for one alert a day. */
  day: string;
  time: string;
  outOfHours: boolean;
}
