import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { and, desc, eq, gte, isNull, lte, ne, notInArray, or, sql, type SQL } from 'drizzle-orm';
import { DEFAULT_SECURITY_SETTINGS, TERMINAL_STATES } from '@jiffo/shared';
import { SELFIE_PREFIX, type SelfieVerdict } from '../adapters/identity';
import { AlertsService } from '../alerts/alerts.service';
import type { ErrandsService } from '../errands/errands.service';
import { ERRANDS } from '../errands/errands.token';
import type { AuthContext } from '../auth/auth.types';
import { conflict, forbidden, notFound } from '../common/errors';
import { CountriesService } from '../countries/countries.service';
import { DB, type Db } from '../db/database.module';
import {
  agentApplications,
  agentPresence,
  agentSelfieChecks,
  devices,
  errands,
  payoutAccounts,
  sessions,
  users,
  type SelfieReason,
} from '../db/schema';
import { IdentityChecksService, type SelfieOwner } from '../identity/identity-checks.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { phoneSelfieReason, SELFIE_WHY } from './phone-selfie';

/** A selfie passed this recently counts as fresh, for changing the payout account (P8). */
export const FRESH_SELFIE_MS = 10 * 60_000;
/** A provider's job made this long before its check started is an older selfie, not this check's. */
const CLOCK_SKEW_MS = 2 * 60_000;

type Outcome = 'passed' | 'failed' | 'retry';
type CheckRow = typeof agentSelfieChecks.$inferSelect;

/**
 * Agents' selfie checks (docs/security-plan.md, A4, I2, I8, P8, X4): a selfie taken in the identity provider's
 * own SDK, compared with the face the provider kept from the agent's first check, so the person working is
 * the agent who was verified. Once a day before going online, at random when the settings ask, on a new
 * phone before money actions, and just before the payout account changes. Failures in a row suspend the
 * account until staff look. Only outcomes are kept, never the selfie.
 */
@Injectable()
export class AgentSelfieService implements SelfieOwner {
  private readonly logger = new Logger('AgentSelfie');

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly countries: CountriesService,
    private readonly checks: IdentityChecksService,
    private readonly alerts: AlertsService,
    private readonly realtime: RealtimeGateway,
    // Errands are reached through this when an account is suspended: they depend on presence, which uses this.
    private readonly moduleRef: ModuleRef,
  ) {
    checks.registerSelfie(this);
  }

  private errands() {
    return this.moduleRef.get<ErrandsService>(ERRANDS, { strict: false });
  }

  private async settings(countryCode: string) {
    const saved = await this.countries.currentSettingsIfAny(countryCode);
    return {
      security: { ...DEFAULT_SECURITY_SETTINGS, ...(saved?.settings.security ?? {}) },
      tries: saved?.settings.identity.selfieTries ?? 3,
      // Selfie checks compare with the face kept from the agent's ID check: none without it.
      on: saved?.settings.identity.agentCheck ?? true,
    };
  }

  /** Whether this country's agents take selfie checks: only where they check their ID. */
  private async selfiesOn(countryCode: string) {
    return (await this.settings(countryCode)).on;
  }

  /** A selfie check passed since `since`. */
  private async passedSince(userId: string, since: SQL | Date) {
    const [row] = await this.db
      .select({ id: agentSelfieChecks.id })
      .from(agentSelfieChecks)
      .where(
        and(
          eq(agentSelfieChecks.userId, userId),
          eq(agentSelfieChecks.status, 'passed'),
          gte(agentSelfieChecks.decidedAt, since),
        ),
      )
      .limit(1);
    return !!row;
  }

  /** A selfie check passed today, in the country's own day. */
  private async passedToday(userId: string, countryCode: string) {
    const { timezone } = await this.countries.basics(countryCode);
    return this.passedSince(userId, sql`(date_trunc('day', now() at time zone ${timezone}) at time zone ${timezone})`);
  }

  /** Why going online needs a selfie first, if it does. With `roll`, a random check may be asked for. */
  private async reasonToGoOnline(auth: AuthContext, roll: boolean): Promise<SelfieReason | null> {
    if (!(await this.selfiesOn(auth.countryCode))) return null;
    const [user] = await this.db.select({ due: users.selfieDue }).from(users).where(eq(users.id, auth.userId));
    if (user?.due) return 'random';
    const { security } = await this.settings(auth.countryCode);
    if (security.dailySelfie && !(await this.passedToday(auth.userId, auth.countryCode))) return 'daily';
    // One just passed covers it, so passing a random check and going online straight after works.
    if (
      roll &&
      security.randomSelfiePercent > 0 &&
      Math.random() * 100 < security.randomSelfiePercent &&
      !(await this.fresh(auth.userId))
    ) {
      // Kept until a selfie passes, so going online again doesn't roll again until it does.
      await this.db.update(users).set({ selfieDue: true }).where(eq(users.id, auth.userId));
      return 'random';
    }
    return null;
  }

  /**
   * Why this phone needs a selfie before money actions, if it does: a new phone, one whose key was replaced
   * (A4, X4), or a sign-in a check doubted (MB3, A10).
   */
  private async neededOnThisPhone(auth: AuthContext) {
    if (!(await this.selfiesOn(auth.countryCode))) return null;
    const [device] = await this.db
      .select({ selfieNeeded: devices.selfieNeeded, selfieFor: devices.selfieFor })
      .from(devices)
      .where(eq(devices.id, auth.deviceId));
    return device ? phoneSelfieReason(device) : null;
  }

  /** A selfie passed in the last few minutes. */
  fresh(userId: string) {
    return this.passedSince(userId, new Date(Date.now() - FRESH_SELFIE_MS));
  }

  /** What the agent app asks before going online, a money action, or changing the payout account. */
  async status(auth: AuthContext) {
    const [toGoOnline, phone, fresh] = await Promise.all([
      this.reasonToGoOnline(auth, false),
      this.neededOnThisPhone(auth),
      this.fresh(auth.userId),
    ]);
    return { toGoOnline, onThisPhone: !!phone, fresh };
  }

  /** The answer an action gets while a selfie is still to take, with what it is for. */
  needed(reason: SelfieReason) {
    return forbidden('selfie_needed', SELFIE_WHY[reason], { reason });
  }

  /**
   * Going online: why a selfie is needed first, if it is: the day's first time online, or a random check
   * (rolled here, when the settings ask for them) (I8).
   */
  neededToGoOnline(auth: AuthContext): Promise<SelfieReason | null> {
    return this.reasonToGoOnline(auth, true);
  }

  /** A phone the app check doubts (MB3): a money action on it needs a selfie passed in the last few minutes. */
  async assertFreshForDevice(auth: AuthContext) {
    if (!(await this.selfiesOn(auth.countryCode))) return;
    if (!(await this.fresh(auth.userId))) throw this.needed('device_check');
  }

  /**
   * Changing the payout account, rather than adding the first: a selfie passed in the last few minutes (P8).
   * Asked before a signed request's single-use code is used, and again where the change is made.
   */
  async assertFreshForPayoutChange(auth: AuthContext) {
    if (!(await this.selfiesOn(auth.countryCode))) return;
    const [current] = await this.db
      .select({ id: payoutAccounts.id })
      .from(payoutAccounts)
      .where(and(eq(payoutAccounts.userId, auth.userId), isNull(payoutAccounts.replacedAt)))
      .limit(1);
    if (current && !(await this.fresh(auth.userId))) throw this.needed('payout_change');
  }

  /**
   * Starts a selfie check: what the provider's SDK in the app needs to take the selfie, against the face kept
   * from the agent's first check (that check's reference is the enrolled id).
   */
  async start(auth: AuthContext, asked?: 'payout_change' | 'device_check') {
    if (!(await this.selfiesOn(auth.countryCode))) {
      throw conflict('selfie_off', "Selfie checks aren't used here");
    }
    const [app] = await this.db
      .select({
        provider: agentApplications.identityProvider,
        reference: agentApplications.identityReference,
        outcome: agentApplications.identityOutcome,
        status: agentApplications.status,
      })
      .from(agentApplications)
      .where(eq(agentApplications.userId, auth.userId));
    // Only once the ID check passed, or staff approved the agent: until then the provider may keep no face,
    // and each selfie against none would be paid for and fail.
    if (!app?.provider || !app.reference || (app.outcome !== 'passed' && app.status !== 'approved')) {
      throw conflict('selfie_unavailable', 'Check your ID in the app first');
    }
    const adapter = this.checks.startedWith(app.provider);
    if (!adapter.startSelfie) {
      throw conflict(
        'selfie_unavailable',
        "Your ID was checked with a service that can't check a selfie. Contact support to check it again.",
      );
    }
    const reason: SelfieReason =
      asked ?? (await this.neededOnThisPhone(auth)) ?? (await this.reasonToGoOnline(auth, false)) ?? 'daily';
    const reference = `${SELFIE_PREFIX}-${randomUUID()}`;
    const enrolledId = app.reference;
    const session = await this.checks.call(
      () => adapter.startSelfie!({ enrolledId, reference }),
      "The selfie couldn't start. Try again in a moment.",
    );
    const [row] = await this.db
      .insert(agentSelfieChecks)
      .values({ userId: auth.userId, deviceId: auth.deviceId, reason, provider: adapter.name, reference })
      .returning({ id: agentSelfieChecks.id });
    return { id: row!.id, provider: adapter.name, reason, session };
  }

  /**
   * After the app's SDK sent the selfie: the verdict, when there is one. The development provider gives it
   * when asked. Smile ID's comes to its webhook; if the job was still running then, its status is asked here.
   */
  async finish(auth: AuthContext, id: string) {
    const [check] = await this.db
      .select()
      .from(agentSelfieChecks)
      .where(and(eq(agentSelfieChecks.id, id), eq(agentSelfieChecks.userId, auth.userId)));
    if (!check) throw notFound('selfie_not_found', 'No such selfie check');
    if (check.status !== 'pending') return this.answer(check);
    const adapter = this.checks.startedWith(check.provider);
    const jobId = check.jobId;
    if (jobId && adapter.selfieJob) {
      const verdict = await this.checks.call(
        () => adapter.selfieJob!(jobId),
        "The selfie couldn't be checked. Try again in a moment.",
      );
      if (verdict) await this.settleWith(check, verdict);
      return this.answer((await this.row(check.id))!);
    }
    if (!adapter.selfieResult) return { status: 'pending' as const };
    const enrolledId = await this.enrolledId(check.userId);
    if (!enrolledId) throw conflict('selfie_unavailable', 'Check your ID in the app first');
    const result = await this.checks.call(
      () => adapter.selfieResult!({ enrolledId, reference: check.reference }),
      "The selfie couldn't be checked. Try again in a moment.",
    );
    if (result.status === 'pending') return { status: 'pending' as const };
    await this.decide(check, result.outcome ?? 'failed', result.note ?? null, null);
    return this.answer((await this.row(check.id))!);
  }

  private async enrolledId(userId: string) {
    const [app] = await this.db
      .select({ reference: agentApplications.identityReference })
      .from(agentApplications)
      .where(eq(agentApplications.userId, userId));
    return app?.reference ?? null;
  }

  /**
   * A selfie verdict the provider sent to its webhook: for the check with this reference, or, when the job
   * carried none, the latest check waiting for the agent whose enrolled face it was, started before the job.
   */
  async settleSelfie(provider: string, reference: string | null, verdict: SelfieVerdict) {
    const check = reference ? await this.byReference(provider, reference) : await this.waitingFor(provider, verdict);
    if (!check || check.status !== 'pending') return false;
    return this.settleWith(check, verdict);
  }

  private async byReference(provider: string, reference: string) {
    const [check] = await this.db
      .select()
      .from(agentSelfieChecks)
      .where(and(eq(agentSelfieChecks.reference, reference), eq(agentSelfieChecks.provider, provider)));
    return check ?? null;
  }

  private async waitingFor(provider: string, verdict: SelfieVerdict) {
    const [agent] = await this.db
      .select({ userId: agentApplications.userId })
      .from(agentApplications)
      .where(
        and(
          eq(agentApplications.identityReference, verdict.enrolledId),
          eq(agentApplications.identityProvider, provider),
        ),
      );
    if (!agent) return null;
    const madeBy = new Date((verdict.createdAt?.getTime() ?? Date.now()) + CLOCK_SKEW_MS);
    const [check] = await this.db
      .select()
      .from(agentSelfieChecks)
      .where(
        and(
          eq(agentSelfieChecks.userId, agent.userId),
          eq(agentSelfieChecks.provider, provider),
          eq(agentSelfieChecks.status, 'pending'),
          lte(agentSelfieChecks.createdAt, madeBy),
        ),
      )
      .orderBy(desc(agentSelfieChecks.createdAt))
      .limit(1);
    return check ?? null;
  }

  /**
   * A provider's verdict for a pending check. It counts only if it is for the agent's own enrolled face and
   * newer than the check; otherwise it fails, as a selfie of someone else would. One job decides one check.
   * A job still running is kept on the check, so finishing it later asks for its status.
   */
  private async settleWith(check: CheckRow, verdict: SelfieVerdict) {
    const [used] = await this.db
      .select({ id: agentSelfieChecks.id })
      .from(agentSelfieChecks)
      .where(
        and(
          eq(agentSelfieChecks.provider, check.provider),
          eq(agentSelfieChecks.jobId, verdict.jobId),
          ne(agentSelfieChecks.id, check.id),
        ),
      );
    if (used) return false;
    const enrolledId = await this.enrolledId(check.userId);
    if (!enrolledId || verdict.enrolledId !== enrolledId) {
      return this.decide(check, 'failed', 'The selfie was checked for another person', verdict.jobId);
    }
    if (verdict.createdAt && verdict.createdAt.getTime() < check.createdAt.getTime() - CLOCK_SKEW_MS) {
      return this.decide(check, 'failed', 'The selfie was taken before this check', verdict.jobId);
    }
    if (verdict.status === 'pending') {
      await this.db
        .update(agentSelfieChecks)
        .set({ jobId: verdict.jobId })
        .where(
          and(
            eq(agentSelfieChecks.id, check.id),
            eq(agentSelfieChecks.status, 'pending'),
            isNull(agentSelfieChecks.jobId),
          ),
        );
      return false;
    }
    // A job kept on the check is the only one that may decide it.
    if (check.jobId && check.jobId !== verdict.jobId) return false;
    return this.decide(check, verdict.outcome ?? 'failed', verdict.note ?? null, verdict.jobId);
  }

  private async row(id: string) {
    const [row] = await this.db.select().from(agentSelfieChecks).where(eq(agentSelfieChecks.id, id));
    return row ?? null;
  }

  /** What the app is told about a decided check. */
  private async answer(check: CheckRow) {
    if (check.status === 'pending') return { status: 'pending' as const };
    if (check.status === 'passed') return { status: 'passed' as const };
    if (check.status === 'unclear') {
      return { status: 'unclear' as const, note: 'The selfie was unclear. Take it again in good light.' };
    }
    const [user] = await this.db
      .select({ failures: users.selfieFailures, status: users.status, countryCode: users.countryCode })
      .from(users)
      .where(eq(users.id, check.userId));
    if (user?.status === 'suspended') return { status: 'suspended' as const };
    const { tries } = await this.settings(user?.countryCode ?? '');
    return { status: 'failed' as const, triesLeft: Math.max(0, tries - (user?.failures ?? 0)), note: check.note };
  }

  /**
   * Decides a pending check, once, however many times its verdict comes. A pass clears what asked for it; an
   * unclear one is taken again without counting; a failure counts, and at identity.selfieTries in a row the
   * account is suspended until staff look (I8): signed out everywhere, offline, and its requests still
   * waiting closed, as a suspension from the panel does. False when the check was decided already.
   */
  private async decide(check: CheckRow, outcome: Outcome, note: string | null, jobId: string | null) {
    const [user] = await this.db
      .select({ countryCode: users.countryCode })
      .from(users)
      .where(eq(users.id, check.userId));
    const countryCode = user?.countryCode ?? '';
    const { tries } = await this.settings(countryCode);
    const status = outcome === 'passed' ? 'passed' : outcome === 'retry' ? 'unclear' : 'failed';
    const decided = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(agentSelfieChecks)
        .set({ status, note: status === 'passed' ? null : note, jobId, decidedAt: new Date() })
        .where(and(eq(agentSelfieChecks.id, check.id), eq(agentSelfieChecks.status, 'pending')))
        .returning({ id: agentSelfieChecks.id });
      if (!row) return null;
      if (status === 'passed') {
        await tx.update(users).set({ selfieFailures: 0, selfieDue: false }).where(eq(users.id, check.userId));
        await tx.update(devices).set({ selfieNeeded: false, selfieFor: null }).where(eq(devices.id, check.deviceId));
        return { suspended: false, failures: 0, open: [] as string[] };
      }
      if (status === 'unclear') return { suspended: false, failures: 0, open: [] as string[] };
      // Under the lock errands take to check the account, so none is accepted or created while this runs.
      const [counted] = await tx
        .update(users)
        .set({ selfieFailures: sql`${users.selfieFailures} + 1` })
        .where(eq(users.id, check.userId))
        .returning({ failures: users.selfieFailures, status: users.status });
      const failures = counted?.failures ?? 0;
      if (failures < tries || counted?.status !== 'active') return { suspended: false, failures, open: [] as string[] };
      await tx.update(users).set({ status: 'suspended', updatedAt: new Date() }).where(eq(users.id, check.userId));
      await tx
        .update(sessions)
        .set({ revokedAt: new Date(), revokedReason: 'selfie_failed' })
        .where(and(eq(sessions.userId, check.userId), isNull(sessions.revokedAt)));
      await tx
        .update(agentPresence)
        .set({ online: false, lat: null, lng: null, location: null, locatedAt: null, updatedAt: new Date() })
        .where(eq(agentPresence.userId, check.userId));
      // As a suspension from the panel does: their own requests still waiting for an agent are closed. Errands
      // under way are left for staff to settle, and listed in the alert.
      const live = await tx
        .select()
        .from(errands)
        .where(
          and(
            or(eq(errands.agentId, check.userId), eq(errands.customerId, check.userId)),
            notInArray(errands.status, [...TERMINAL_STATES]),
          ),
        )
        .for('update');
      const errandsService = this.errands();
      const closed = [];
      for (const errand of live.filter((e) => e.status === 'requested')) {
        closed.push(
          await errandsService.adminCancelWaiting(
            tx,
            errand,
            null,
            'The account was suspended after failed selfie checks',
          ),
        );
      }
      const open = live.filter((e) => e.status !== 'requested').map((e) => e.id);
      return { suspended: true, failures, open, closed };
    });
    if (!decided) return false;
    if (decided.suspended) {
      this.realtime.disconnectUser(check.userId);
      const closed = 'closed' in decided ? (decided.closed ?? []) : [];
      if (closed.length) {
        await this.errands()
          .announce(closed)
          .catch((error: unknown) => this.logger.warn(`Closed errands not announced: ${String(error)}`));
      }
      const n = decided.open.length;
      await this.alerts
        .raise({
          countryCode,
          kind: 'selfie_failed',
          dedupeKey: check.userId,
          message:
            `An agent failed ${decided.failures} selfie checks in a row, so their account is suspended. ` +
            (n ? `They have ${n} errand${n === 1 ? '' : 's'} under way: settle ${n === 1 ? 'it' : 'them'} too. ` : '') +
            'Reactivate the account if it was them.',
          data: { userId: check.userId, errandIds: decided.open },
        })
        .catch((error: unknown) => this.logger.warn(`Selfie alert not raised: ${String(error)}`));
    }
    return true;
  }
}
