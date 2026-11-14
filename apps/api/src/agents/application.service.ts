import { Injectable, Inject, Logger } from '@nestjs/common';
import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import { ID_TYPE_KEYS, ID_TYPES, yearsOld, type IdType } from '@jiffo/shared';
import { DB, type Db, type Tx } from '../db/database.module';
import { agentApplications, agentPresence, agentProfiles, payoutAccounts, states, users } from '../db/schema';
import { type IdentityAdapter, type IdentityRequest, type IdentityResult } from '../adapters/identity';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../common/errors';
import { matchesLegalName } from '../common/names';
import {
  ID_CHECK_LABELS,
  IdentityChecksService,
  type IdentityOwner,
  type PendingCheck,
} from '../identity/identity-checks.service';
import { PushService } from '../push/push.service';
import { CountriesService } from '../countries/countries.service';

type Application = typeof agentApplications.$inferSelect;
type Check = { key: string; outcome: string; note?: string };

/** What the checklist says about each check, in the agent's words. */
export const CHECK_LABELS: Record<string, string> = {
  ...ID_CHECK_LABELS,
  name: 'Your name matches your ID',
  address: 'Address confirmed',
  bank: 'Bank account name matches your ID',
  duplicate: 'No other agent account on this ID',
};
/** The checks that come from the identity check, whichever ID it used. */
const IDENTITY_CHECKS: string[] = [...ID_TYPE_KEYS, 'selfie', 'id_type', 'duplicate'];
/** The check an application started, as the identity service takes it. */
const requestOf = (app: Application): IdentityRequest => ({
  role: 'agent',
  idType: (app.identityIdType ?? 'nin') as IdType,
  withBvn: app.identityWithBvn,
});
/** While checking, the provider is asked again at most this often, however often the app looks. */
const POLL_EVERY_MS = 15_000;

/**
 * An agent's application: the checklist the agent app walks through, the provider's checks, and the decision.
 * Agents can see the board and accept errands only once it is approved.
 */
@Injectable()
export class AgentApplicationService implements IdentityOwner {
  private readonly logger = new Logger(AgentApplicationService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly checks: IdentityChecksService,
    private readonly push: PushService,
    private readonly countries: CountriesService,
  ) {
    checks.register('agent', this);
  }

  private async load(userId: string): Promise<Application> {
    const [existing] = await this.db.select().from(agentApplications).where(eq(agentApplications.userId, userId));
    if (existing) return existing;
    const [user] = await this.db.select({ countryCode: users.countryCode }).from(users).where(eq(users.id, userId));
    await this.db.insert(agentApplications).values({ userId, countryCode: user!.countryCode }).onConflictDoNothing();
    return (await this.db.select().from(agentApplications).where(eq(agentApplications.userId, userId)))[0]!;
  }

  private async person(userId: string) {
    const [user] = await this.db.select().from(users).where(eq(users.id, userId));
    if (!user?.firstName || !user.lastName) {
      throw conflict('profile_incomplete', 'Add your first and last name, as on your ID, first');
    }
    return { firstName: user.firstName, lastName: user.lastName, phone: user.phone };
  }

  /** The provider an address check was started with, as for identity checks. */
  private startedWith(name: string | null): IdentityAdapter {
    return this.checks.startedWith(name);
  }

  /**
   * Writes to a draft application only: the status is checked in the same statement, so an edit can never
   * land after the application has been sent.
   */
  private async updateDraft(userId: string, set: Partial<typeof agentApplications.$inferInsert>) {
    const [row] = await this.db
      .update(agentApplications)
      .set({ ...set, updatedAt: new Date() })
      .where(and(eq(agentApplications.userId, userId), eq(agentApplications.status, 'draft')))
      .returning();
    if (!row) {
      throw conflict('application_submitted', 'Your application is already sent. We will text you when it is checked.');
    }
    return row;
  }

  /** The checklist as the agent app shows it. Checks still running are asked about again, now and then. */
  async view(userId: string) {
    let app = await this.load(userId);
    const stale = Date.now() - app.updatedAt.getTime() > POLL_EVERY_MS;
    if (app.status === 'checking' && stale) app = await this.refresh(app);
    // An identity check whose result wasn't back when the app last asked: the provider is asked again here.
    if (app.status === 'draft' && app.identityReference && app.identityOutcome === null && stale) {
      await this.settleIdentity(app).catch((error: unknown) =>
        this.logger.warn(`Identity check for ${userId} could not be read: ${String(error)}`),
      );
      app = await this.load(userId);
    }
    const [user, payout, profile, state, { settings }] = await Promise.all([
      this.db.select().from(users).where(eq(users.id, userId)),
      this.db
        .select({ accountName: payoutAccounts.accountName })
        .from(payoutAccounts)
        .where(and(eq(payoutAccounts.userId, userId), isNull(payoutAccounts.replacedAt))),
      this.db.select({ userId: agentProfiles.userId }).from(agentProfiles).where(eq(agentProfiles.userId, userId)),
      app.stateCode
        ? this.db
            .select({ name: states.name, agentSignups: states.agentSignups })
            .from(states)
            .where(and(eq(states.countryCode, app.countryCode), eq(states.code, app.stateCode)))
        : Promise.resolve([]),
      this.countries.currentSettings(app.countryCode),
    ]);
    const u = user[0]!;
    const steps = {
      basics: !!(u.firstName && u.lastName && app.stateCode && app.area),
      identity: app.identityOutcome !== null,
      address: !!(app.address && app.emergencyName && app.emergencyPhone),
      bank: payout.length > 0,
      prefs: profile.length > 0,
      learn: app.termsAcceptedAt !== null,
    };
    const options = this.checks.options('agent', settings.identity);
    return {
      status: app.status,
      steps,
      /** "hosted": a web page asks for the ID and takes the selfie, so the app opens it instead. */
      identityFlow: options.flow,
      /** The IDs the agent can verify with now, and whether their BVN is checked as well. */
      idTypes: options.idTypes.map((key) => ({ key, name: ID_TYPES[key].name })),
      withBvn: options.withBvn,
      /** The agent picks the ID on the provider's page rather than in the app. */
      idChosenOnPage: options.idChosenOnPage,
      /** The ID the current or last check used, whether it checked the BVN too, and how it ran. */
      identityIdType: app.identityIdType,
      identityWithBvn: app.identityWithBvn,
      identityStartedFlow: app.identityProvider ? this.checks.startedWith(app.identityProvider).flow : null,
      /** Started with the provider, and its result not back yet. */
      identityChecking: app.identityReference !== null && app.identityOutcome === null,
      stateCode: app.stateCode,
      stateName: state[0]?.name ?? null,
      waitlisted: state[0]?.agentSignups === 'waitlist',
      area: app.area,
      address: app.address,
      emergency: app.emergencyName
        ? { name: app.emergencyName, phone: app.emergencyPhone, relationship: app.emergencyRelationship }
        : null,
      // The ID record's name only once the checks showed the ID is theirs (docs/security-plan.md, I1).
      legalName: app.status === 'approved' || app.identityOutcome === 'passed' ? app.legalName : null,
      checks: app.checks.map((c) => ({ ...c, label: CHECK_LABELS[c.key] ?? c.key })),
      submittedAt: app.submittedAt,
      /** Who runs the checks, as the app names them, and how soon support usually looks at one in review. */
      provider: options.providerName,
      reviewHours: settings.identity.reviewTargetHours,
      /** Said to the agent only when support declined the application. */
      decisionNote: app.status === 'rejected' ? app.decisionNote : null,
    };
  }

  async saveBasics(userId: string, input: { stateCode?: string; area?: string }) {
    const app = await this.load(userId);
    if (input.stateCode) {
      const [state] = await this.db
        .select({ id: states.id })
        .from(states)
        .where(and(eq(states.countryCode, app.countryCode), eq(states.code, input.stateCode)));
      if (!state) throw badRequest('unknown_state', 'Choose a state from the list');
    }
    await this.updateDraft(userId, input);
    return this.view(userId);
  }

  /**
   * Starts the identity check with the provider, for the ID the agent chose (and their BVN when it is
   * required). Any numbers go to the provider and are not kept; the ID's fingerprint waits as pending until
   * the provider shows the ID is theirs.
   */
  async startIdentity(
    userId: string,
    input: { idType?: string; idNumber?: string; nin?: string; bvn?: string },
    sessionId: string,
  ) {
    const app = await this.load(userId);
    if (app.status !== 'draft') {
      throw conflict('application_submitted', 'Your application is already sent. We will text you when it is checked.');
    }
    const person = await this.person(userId);
    const { settings } = await this.countries.currentSettings(app.countryCode);
    // Earlier versions of the app send only a NIN.
    const idType = input.idType ?? (input.nin ? 'nin' : undefined);
    const started = await this.checks.start(
      'agent',
      person,
      settings.identity,
      {
        idType,
        idNumber: input.idNumber ?? input.nin,
        bvn: input.bvn,
      },
      userId,
    );
    await this.updateDraft(userId, {
      pendingIdFingerprint: started.pendingFingerprint,
      identityProvider: started.provider,
      identityReference: started.reference,
      identitySessionId: sessionId,
      identityIdType: started.request.idType,
      identityWithBvn: started.request.withBvn,
      identityOutcome: null,
      identityCheckedAt: null,
    });
    return { sdkToken: started.sdkToken, url: started.url, provider: started.provider };
  }

  /** The application waiting on a check started with this provider and reference, if any. */
  async waiting(provider: string, reference: string): Promise<PendingCheck | null> {
    const [app] = await this.db
      .select()
      .from(agentApplications)
      .where(
        and(
          eq(agentApplications.identityProvider, provider),
          eq(agentApplications.identityReference, reference),
          eq(agentApplications.status, 'draft'),
          isNull(agentApplications.identityOutcome),
        ),
      );
    return app
      ? { userId: app.userId, provider, reference, request: requestOf(app), sessionId: app.identitySessionId }
      : null;
  }

  /** A provider's result for a check still waited on, as the identity service hands it over. */
  async settle(check: PendingCheck, result: IdentityResult) {
    const app = await this.load(check.userId);
    if (app.identityReference !== check.reference) return null;
    return this.applyIdentity(app, result);
  }

  /**
   * After the provider's screens finish in the app: reads the result from the provider and keeps it. When the
   * ID and selfie show the ID is this person's, its fingerprint is claimed; if another agent account already
   * holds it, the identity goes to support rather than answering who owns which ID.
   */
  async finishIdentity(userId: string) {
    const app = await this.load(userId);
    if (app.status !== 'draft') {
      throw conflict('application_submitted', 'Your application is already sent. We will text you when it is checked.');
    }
    if (!app.identityReference) throw conflict('identity_not_started', 'Start with your ID');
    // Already settled, as when the provider sent the result to its webhook.
    if (app.identityOutcome) {
      const checks = app.checks.filter((c) => IDENTITY_CHECKS.includes(c.key));
      return { status: 'done' as const, outcome: app.identityOutcome, checks };
    }
    return this.settleIdentity(app);
  }

  /** Asks the provider for the identity result, and keeps it once it is back. */
  private async settleIdentity(app: Application) {
    const result = await this.checks.result({ provider: app.identityProvider!, reference: app.identityReference! });
    if (result.status === 'pending') {
      // Remembered, so the checklist doesn't ask the provider again before POLL_EVERY_MS.
      await this.db
        .update(agentApplications)
        .set({ updatedAt: new Date() })
        .where(eq(agentApplications.userId, app.userId));
      return { status: 'pending' as const };
    }
    const settled = await this.applyIdentity(app, result);
    if (settled) return settled;
    // Settled meanwhile, as by the provider's webhook: that result stands.
    const now = await this.load(app.userId);
    if (now.identityReference === app.identityReference && now.identityOutcome) {
      const checks = now.checks.filter((c) => IDENTITY_CHECKS.includes(c.key));
      return { status: 'done' as const, outcome: now.identityOutcome, checks };
    }
    throw conflict('identity_changed', 'Your identity check was started again. Finish that one.');
  }

  /**
   * Keeps a finished identity result on the application, if it is still the check the application waits for.
   * When the ID and selfie show the ID is this person's, its fingerprint is claimed; if another agent account
   * already holds it, the identity goes to support rather than answering who owns which ID. Otherwise the
   * fingerprint waits as pending, so support's approval claims it, or finds it already held.
   */
  private async applyIdentity(app: Application, result: IdentityResult) {
    const userId = app.userId;
    const { settings } = await this.countries.currentSettings(app.countryCode);
    const judged = this.checks.judge(
      requestOf(app),
      result,
      this.checks.accepted('agent', settings.identity, app.identityProvider ?? 'none'),
    );
    // The ID's fingerprint: of the ID the provider read, when its own page asked; else of what the app sent.
    const fingerprint = judged.fingerprint ?? app.pendingIdFingerprint;
    return this.db.transaction(async (tx) => {
      let outcome = judged.outcome;
      const checks: Check[] = [...judged.checks];
      let claim: string | null = null;
      if (judged.own && fingerprint) {
        // One claim at a time per ID, so two accounts can't both take it at the same moment.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'id:' + fingerprint}))`);
        const [holder] = await tx
          .select({ userId: agentApplications.userId })
          .from(agentApplications)
          .where(and(eq(agentApplications.idFingerprint, fingerprint), ne(agentApplications.userId, userId)));
        if (holder) {
          checks.push({ key: 'duplicate', outcome: 'review', note: 'Another agent account uses this ID' });
          if (outcome === 'passed') outcome = 'review';
        } else {
          claim = fingerprint;
        }
      }
      const [row] = await tx
        .update(agentApplications)
        .set({
          identityOutcome: outcome,
          identityCheckedAt: new Date(),
          identityIdType: judged.idType,
          legalName: judged.legalName,
          dateOfBirth: judged.dateOfBirth,
          // Only an ID this check showed to be theirs is held; an earlier one is let go.
          idFingerprint: claim,
          pendingIdFingerprint: claim ? null : fingerprint,
          checks: [...checks, ...app.checks.filter((c) => !IDENTITY_CHECKS.includes(c.key))],
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(agentApplications.userId, userId),
            eq(agentApplications.status, 'draft'),
            eq(agentApplications.identityReference, app.identityReference!),
            // Settled once: a second result for the same check, arriving at the same time, is let go.
            isNull(agentApplications.identityOutcome),
          ),
        )
        .returning({ userId: agentApplications.userId });
      if (!row) {
        const [now] = await tx
          .select({ status: agentApplications.status })
          .from(agentApplications)
          .where(eq(agentApplications.userId, userId));
        if (now?.status !== 'draft') throw conflict('application_submitted', 'Your application is already sent');
        return null;
      }
      return { status: 'done' as const, outcome, checks };
    });
  }

  async saveAddress(
    userId: string,
    input: { address: string; emergency: { name: string; phone: string; relationship?: string } },
  ) {
    await this.load(userId);
    await this.updateDraft(userId, {
      address: input.address,
      emergencyName: input.emergency.name,
      emergencyPhone: input.emergency.phone,
      emergencyRelationship: input.emergency.relationship ?? null,
    });
    return this.view(userId);
  }

  async acceptTerms(userId: string) {
    await this.load(userId);
    await this.updateDraft(userId, { termsAcceptedAt: new Date() });
    return this.view(userId);
  }

  /**
   * Sends the application: every step must be done. The draft is claimed first, so a second tap can't start
   * a second address check; then the address check starts and the rest is decided once it is back.
   */
  async submit(userId: string) {
    const before = await this.view(userId);
    if (before.status !== 'draft') throw conflict('application_submitted', 'Your application is already sent');
    const missing = Object.entries(before.steps)
      .filter(([, done]) => !done)
      .map(([step]) => step);
    if (missing.length) throw unprocessable('application_incomplete', 'Finish every step first', { missing });
    if (before.waitlisted) {
      throw conflict('waitlisted', `Agent sign-ups in ${before.stateName} are on a waitlist for now`);
    }
    const person = await this.person(userId);
    const claimed = await this.updateDraft(userId, { status: 'checking', submittedAt: new Date() });
    let reference: string;
    const identity = this.checks.current();
    try {
      ({ reference } = await this.checks.call(() =>
        identity.startAddress({
          person,
          area: claimed.area ?? undefined,
          address: claimed.address!,
          state: before.stateName ?? claimed.stateCode ?? '',
        }),
      ));
    } catch (error) {
      // The check never started: back to a draft the agent can send again.
      await this.db
        .update(agentApplications)
        .set({ status: 'draft', submittedAt: null, updatedAt: new Date() })
        .where(and(eq(agentApplications.userId, userId), eq(agentApplications.status, 'checking')));
      throw error;
    }
    const [sent] = await this.db
      .update(agentApplications)
      .set({ addressProvider: identity.name, addressReference: reference, updatedAt: new Date() })
      .where(eq(agentApplications.userId, userId))
      .returning();
    await this.refresh(sent!);
    return this.view(userId);
  }

  /** While checking: asks the provider about the address, and decides once everything is back. */
  private async refresh(app: Application): Promise<Application> {
    if (!app.addressReference) return app;
    let address: Awaited<ReturnType<IdentityAdapter['addressResult']>>;
    try {
      address = await this.checks.call(() =>
        this.startedWith(app.addressProvider).addressResult(app.addressReference!),
      );
    } catch (error) {
      this.logger.warn(`Address check for ${app.userId} could not be read: ${String(error)}`);
      address = { status: 'pending' };
    }
    if (address.status === 'pending') {
      // Remembered, so the provider isn't asked again before POLL_EVERY_MS.
      await this.db
        .update(agentApplications)
        .set({ updatedAt: new Date() })
        .where(eq(agentApplications.userId, app.userId));
      return app;
    }
    const [payout] = await this.db
      .select({ accountName: payoutAccounts.accountName })
      .from(payoutAccounts)
      .where(and(eq(payoutAccounts.userId, app.userId), isNull(payoutAccounts.replacedAt)));
    const [user] = await this.db.select().from(users).where(eq(users.id, app.userId));
    const fullName = `${user!.firstName ?? ''} ${user!.lastName ?? ''}`;
    const legal = app.legalName ?? '';
    const own = app.checks.filter((c) => IDENTITY_CHECKS.includes(c.key));
    // The checks the identity check asked for must be there and passed, any other that came back too, and
    // the provider's overall answer.
    const request = requestOf(app);
    const required = [request.idType, 'selfie', ...(request.withBvn && request.idType !== 'bvn' ? ['bvn'] : [])];
    const identityChecks: Check[] = [
      ...own.filter((c) => c.key !== 'duplicate'),
      ...required
        .filter((key) => !own.some((c) => c.key === key))
        .map((key) => ({ key, outcome: 'review', note: 'No result from the provider' })),
    ];
    const pass = (ok: boolean, note: string): { outcome: 'passed' | 'review'; note?: string } =>
      ok ? { outcome: 'passed' } : { outcome: 'review', note };
    const checks: Check[] = [
      ...identityChecks,
      ...own.filter((c) => c.key === 'duplicate'),
      {
        key: 'age',
        ...(app.dateOfBirth
          ? yearsOld(app.dateOfBirth) >= 18
            ? { outcome: 'passed' }
            : { outcome: 'failed', note: 'Agents must be 18 or older' }
          : { outcome: 'review', note: 'No date of birth on the NIN record' }),
      },
      {
        key: 'name',
        ...pass(!!legal && matchesLegalName(fullName, legal), 'The name in the app differs from the NIN record'),
      },
      { key: 'address', outcome: address.outcome!, ...(address.note ? { note: address.note } : {}) },
      {
        key: 'bank',
        ...pass(
          !!payout && !!legal && matchesLegalName(payout.accountName, legal),
          'The bank account is in another name',
        ),
      },
    ];
    // Approved only when the provider's overall answer and every single check passed; anything else waits
    // for support, who decide. Nobody is turned away by a machine.
    const approved = app.identityOutcome === 'passed' && checks.every((c) => c.outcome === 'passed');
    const [after] = await this.db
      .update(agentApplications)
      .set({
        addressOutcome: address.outcome!,
        checks,
        status: approved ? 'approved' : 'review',
        decidedAt: approved ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(and(eq(agentApplications.userId, app.userId), eq(agentApplications.status, 'checking')))
      .returning();
    if (!after)
      return (await this.db.select().from(agentApplications).where(eq(agentApplications.userId, app.userId)))[0]!;
    await this.push.notifyUser(app.userId, 'agent', {
      title: approved ? "You're approved" : 'We are checking your application',
      body: approved
        ? 'Go online to see errands near you.'
        : 'Some checks need a closer look. Our team will text you, usually within 24 hours.',
      data: { type: 'agent.application', status: after.status },
    });
    return after;
  }

  /**
   * Support's decision, made inside the caller's transaction so it is audited with it. Approving needs an
   * application in review (or one declined by mistake) with no failed check, and claims the agent's NIN as
   * the checks would have: an approved agent always holds their NIN, and no two approved agents share one.
   * Declining takes the agent offline; an errand they already have can still be finished. Reopening a
   * declined application lets the agent change it and send it again.
   */
  async decide(
    tx: Tx,
    input: { userId: string; decision: 'approve' | 'reject' | 'reopen'; adminId: string; note: string },
  ) {
    const [app] = await tx
      .select()
      .from(agentApplications)
      .where(eq(agentApplications.userId, input.userId))
      .for('update');
    if (!app) throw notFound('application_not_found', 'This person has no agent application');
    const from = { approve: ['review', 'rejected'], reject: ['review'], reopen: ['rejected'] }[input.decision];
    if (!from.includes(app.status)) {
      throw conflict(
        input.decision === 'reopen' ? 'not_declined' : 'not_in_review',
        input.decision === 'reopen'
          ? 'Only a declined application can be reopened'
          : 'Only an application in review can be decided',
        { status: app.status },
      );
    }
    const decided = {
      decidedAt: new Date(),
      decidedBy: input.adminId,
      decisionNote: input.note,
      updatedAt: new Date(),
    };

    if (input.decision === 'reopen') {
      const [row] = await tx
        .update(agentApplications)
        .set({
          status: 'draft',
          submittedAt: null,
          decidedAt: null,
          decidedBy: null,
          decisionNote: null,
          updatedAt: new Date(),
        })
        .where(eq(agentApplications.userId, input.userId))
        .returning();
      return { before: app, after: row! };
    }

    if (input.decision === 'reject') {
      const [row] = await tx
        .update(agentApplications)
        .set({ status: 'rejected', ...decided })
        .where(eq(agentApplications.userId, input.userId))
        .returning();
      await tx
        .update(agentPresence)
        .set({ online: false, updatedAt: new Date() })
        .where(eq(agentPresence.userId, input.userId));
      return { before: app, after: row! };
    }

    const failed = app.checks.filter((c) => c.outcome === 'failed');
    if (failed.length) {
      throw unprocessable('check_failed', 'A check failed, so this application can only be declined', {
        failed: failed.map((c) => c.key),
      });
    }
    let idFingerprint = app.idFingerprint;
    if (!idFingerprint && app.pendingIdFingerprint) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'id:' + app.pendingIdFingerprint}))`);
      const [holder] = await tx
        .select({ userId: agentApplications.userId, status: agentApplications.status })
        .from(agentApplications)
        .where(
          and(
            eq(agentApplications.idFingerprint, app.pendingIdFingerprint),
            ne(agentApplications.userId, input.userId),
          ),
        );
      // An account holds an ID only once its own ID and selfie checks proved it theirs, so it is the ID's
      // likely owner. Approving this one never takes the ID away from it (docs/security-plan.md, 22): support
      // reopens a declined one instead, and a draft's owner can finish their own application.
      if (holder) {
        const why = {
          approved: 'Another approved agent account uses this ID.',
          rejected: 'Another agent account proved this ID and was declined. Reopen that application instead.',
          draft: "Another agent account proved this ID and hasn't sent its application yet. Its owner can finish it.",
        }[holder.status as 'approved' | 'rejected' | 'draft'];
        throw conflict(
          'nin_held',
          why ?? 'Another agent account proved this ID with its own checks. Decide that one first.',
          {
            userId: holder.userId,
            holderStatus: holder.status,
          },
        );
      }
      idFingerprint = app.pendingIdFingerprint;
    }
    const [row] = await tx
      .update(agentApplications)
      .set({ status: 'approved', idFingerprint, ...decided })
      .where(eq(agentApplications.userId, input.userId))
      .returning();
    return { before: app, after: row! };
  }

  /**
   * The name on the agent's ID record, for checking a payout account is theirs: kept only for a check that
   * didn't fail. It is used even while support reviews the check, so the account must match the ID, not the
   * name in the app; the agent is shown it only once approved.
   */
  async legalName(userId: string) {
    const [row] = await this.db
      .select({ legalName: agentApplications.legalName, outcome: agentApplications.identityOutcome })
      .from(agentApplications)
      .where(eq(agentApplications.userId, userId));
    return row?.outcome && row.outcome !== 'failed' && row.legalName ? row.legalName : null;
  }

  /** Refuses agents whose application isn't approved: they can't see the board, go online or accept. */
  async assertApproved(userId: string) {
    if (!(await this.approved(userId))) {
      throw forbidden('application_pending', 'Finish your application, and once it is approved you can take errands');
    }
  }

  /** Whether the agent may take errands. */
  async approved(userId: string) {
    const [row] = await this.db
      .select({ status: agentApplications.status })
      .from(agentApplications)
      .where(eq(agentApplications.userId, userId));
    return row?.status === 'approved';
  }
}
