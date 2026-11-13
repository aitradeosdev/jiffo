import { Injectable, Inject, Logger } from '@nestjs/common';
import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import { createHmac, hkdfSync } from 'node:crypto';
import { normaliseIdNumber } from '@jiffo/shared';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { DB, type Db } from '../db/database.module';
import { agentApplications, agentProfiles, payoutAccounts, states, users } from '../db/schema';
import { IDENTITY, IdentityUnavailable, type CheckOutcome, type IdentityAdapter } from '../adapters/identity';
import { badRequest, conflict, forbidden, unavailable, unprocessable } from '../common/errors';
import { nameWords } from '../common/names';
import { PushService } from '../push/push.service';

type Application = typeof agentApplications.$inferSelect;
type Check = { key: string; outcome: string; note?: string };

/** What the checklist says about each check, in the agent's words. */
const CHECK_LABELS: Record<string, string> = {
  nin: 'NIN matches your details',
  bvn: 'BVN matches your details',
  selfie: 'Selfie matches your ID photo',
  age: 'Age 18 or older',
  name: 'Your name matches your NIN',
  address: 'Address confirmed',
  bank: 'Bank account name matches your ID',
  duplicate: 'No other agent account on this NIN',
};
const IDENTITY_CHECKS = ['nin', 'bvn', 'selfie'];
/** While checking, the provider is asked again at most this often, however often the app looks. */
const POLL_EVERY_MS = 15_000;

const yearsSince = (isoDate: string) => {
  const born = new Date(`${isoDate}T00:00:00Z`);
  const now = new Date();
  let years = now.getUTCFullYear() - born.getUTCFullYear();
  const beforeBirthday =
    now.getUTCMonth() < born.getUTCMonth() ||
    (now.getUTCMonth() === born.getUTCMonth() && now.getUTCDate() < born.getUTCDate());
  if (beforeBirthday) years -= 1;
  return years;
};

/**
 * Whether a name (a bank account's, or the one in the app) belongs to the person on the NIN record: it has
 * at least two words, and every one of them is in the legal name. Banks and apps drop middle names, but they
 * can't add a name that isn't on the record.
 */
export function matchesLegalName(name: string, legalName: string) {
  const legal = nameWords(legalName);
  const words = [...nameWords(name)];
  return words.length >= 2 && words.every((w) => legal.has(w));
}

/**
 * An agent's application: the checklist the agent app walks through, the provider's checks, and the decision.
 * Agents can see the board and accept errands only once it is approved.
 */
@Injectable()
export class AgentApplicationService {
  private readonly logger = new Logger(AgentApplicationService.name);
  /** Its own key, derived from PIN_KEY, used only to fingerprint NINs. */
  private readonly ninKey: Buffer;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(IDENTITY) private readonly identity: IdentityAdapter,
    @Inject(APP_CONFIG) config: AppConfig,
    private readonly push: PushService,
  ) {
    this.ninKey = Buffer.from(
      hkdfSync('sha256', Buffer.from(config.PIN_KEY, 'hex'), Buffer.alloc(0), 'jiffo nin fingerprint', 32),
    );
  }

  private fingerprint(nin: string) {
    return createHmac('sha256', this.ninKey).update(nin).digest('hex');
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
      throw conflict('profile_incomplete', 'Add your first and last name, as on your NIN, first');
    }
    return { firstName: user.firstName, lastName: user.lastName, phone: user.phone };
  }

  /** Calls the provider, turning "no provider set up" into an answer the app can show. */
  private async provider<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      if (error instanceof IdentityUnavailable) {
        throw unavailable(
          'identity_unavailable',
          "Identity checks aren't available yet. We'll text you when they are.",
        );
      }
      throw error;
    }
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
    if (app.status === 'checking' && Date.now() - app.updatedAt.getTime() > POLL_EVERY_MS)
      app = await this.refresh(app);
    const [user, payout, profile, state] = await Promise.all([
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
    return {
      status: app.status,
      steps,
      stateCode: app.stateCode,
      stateName: state[0]?.name ?? null,
      waitlisted: state[0]?.agentSignups === 'waitlist',
      area: app.area,
      address: app.address,
      emergency: app.emergencyName
        ? { name: app.emergencyName, phone: app.emergencyPhone, relationship: app.emergencyRelationship }
        : null,
      legalName: app.legalName,
      checks: app.checks.map((c) => ({ ...c, label: CHECK_LABELS[c.key] ?? c.key })),
      submittedAt: app.submittedAt,
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
   * Starts the NIN, BVN and selfie checks with the provider. The numbers go to the provider and are not kept.
   * The NIN's fingerprint waits as pending: it is claimed only once the provider confirms the NIN is theirs.
   */
  async startIdentity(userId: string, input: { nin: string; bvn: string }) {
    const nin = normaliseIdNumber('nin', input.nin);
    const bvn = normaliseIdNumber('bvn', input.bvn);
    if (!nin) throw badRequest('invalid_nin', 'A NIN is 11 digits');
    if (!bvn) throw badRequest('invalid_bvn', 'A BVN is 11 digits');
    const app = await this.load(userId);
    if (app.status !== 'draft') {
      throw conflict('application_submitted', 'Your application is already sent. We will text you when it is checked.');
    }
    const person = await this.person(userId);
    const started = await this.provider(() => this.identity.startIdentity({ person, nin, bvn }));
    await this.updateDraft(userId, {
      pendingNinFingerprint: this.fingerprint(nin),
      identityReference: started.reference,
      identityOutcome: null,
      identityCheckedAt: null,
    });
    return { sdkToken: started.sdkToken, provider: this.identity.name };
  }

  /**
   * After the provider's SDK finishes in the app: reads the result from the provider and keeps it. When the
   * NIN and selfie show the NIN is this person's, its fingerprint is claimed; if another agent account
   * already holds it, the identity goes to support rather than answering who owns which NIN.
   */
  async finishIdentity(userId: string) {
    const app = await this.load(userId);
    if (app.status !== 'draft') {
      throw conflict('application_submitted', 'Your application is already sent. We will text you when it is checked.');
    }
    if (!app.identityReference) throw conflict('identity_not_started', 'Start with your NIN and BVN');
    const result = await this.provider(() => this.identity.identityResult(app.identityReference!));
    if (result.status === 'pending') return { status: 'pending' as const };

    const passed = (key: string) => result.checks.some((c) => c.key === key && c.outcome === 'passed');
    const own = passed('nin') && passed('selfie');
    return this.db.transaction(async (tx) => {
      let outcome: CheckOutcome = result.outcome ?? 'review';
      const checks: Check[] = [...result.checks];
      let claim: string | null = null;
      if (own && app.pendingNinFingerprint) {
        // One claim at a time per NIN, so two accounts can't both take it at the same moment.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'nin:' + app.pendingNinFingerprint}))`);
        const [holder] = await tx
          .select({ userId: agentApplications.userId })
          .from(agentApplications)
          .where(
            and(eq(agentApplications.ninFingerprint, app.pendingNinFingerprint), ne(agentApplications.userId, userId)),
          );
        if (holder) {
          checks.push({ key: 'duplicate', outcome: 'review', note: 'Another agent account uses this NIN' });
          if (outcome === 'passed') outcome = 'review';
        } else {
          claim = app.pendingNinFingerprint;
        }
      }
      const [row] = await tx
        .update(agentApplications)
        .set({
          identityOutcome: outcome,
          identityCheckedAt: new Date(),
          legalName: result.legalName ?? null,
          dateOfBirth: result.dateOfBirth ?? null,
          // Only a NIN this check showed to be theirs is held; an earlier one is let go.
          ninFingerprint: claim,
          checks: [...checks, ...app.checks.filter((c) => ![...IDENTITY_CHECKS, 'duplicate'].includes(c.key))],
          updatedAt: new Date(),
        })
        .where(and(eq(agentApplications.userId, userId), eq(agentApplications.status, 'draft')))
        .returning({ userId: agentApplications.userId });
      if (!row) throw conflict('application_submitted', 'Your application is already sent');
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
    try {
      ({ reference } = await this.provider(() =>
        this.identity.startAddress({
          person,
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
      .set({ addressReference: reference, updatedAt: new Date() })
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
      address = await this.provider(() => this.identity.addressResult(app.addressReference!));
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
    const own = app.checks.filter((c) => [...IDENTITY_CHECKS, 'duplicate'].includes(c.key));
    // Every identity check must be there and passed, as well as the provider's overall answer.
    const identityChecks: Check[] = IDENTITY_CHECKS.map(
      (key) => own.find((c) => c.key === key) ?? { key, outcome: 'review', note: 'No result from the provider' },
    );
    const pass = (ok: boolean, note: string): { outcome: CheckOutcome; note?: string } =>
      ok ? { outcome: 'passed' } : { outcome: 'review', note };
    const checks: Check[] = [
      ...identityChecks,
      ...own.filter((c) => c.key === 'duplicate'),
      {
        key: 'age',
        ...(app.dateOfBirth
          ? yearsSince(app.dateOfBirth) >= 18
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

  /** The verified legal name, once the provider has checked the agent's NIN. */
  async legalName(userId: string) {
    const [row] = await this.db
      .select({ legalName: agentApplications.legalName, outcome: agentApplications.identityOutcome })
      .from(agentApplications)
      .where(eq(agentApplications.userId, userId));
    return row?.outcome && row.legalName ? row.legalName : null;
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
