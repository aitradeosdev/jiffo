import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, isNull, ne } from 'drizzle-orm';
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
};

const yearsSince = (isoDate: string) => {
  const born = new Date(`${isoDate}T00:00:00Z`);
  const now = new Date();
  let years = now.getUTCFullYear() - born.getUTCFullYear();
  if (
    now.getUTCMonth() < born.getUTCMonth() ||
    (now.getUTCMonth() === born.getUTCMonth() && now.getUTCDate() < born.getUTCDate())
  ) {
    years -= 1;
  }
  return years;
};

/** Every word of `part` appears in `whole`, ignoring case and accents. */
const namesWithin = (part: string, whole: string) => {
  const have = nameWords(whole);
  return [...nameWords(part)].every((w) => have.has(w));
};

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
    const [made] = await this.db
      .insert(agentApplications)
      .values({ userId, countryCode: user!.countryCode })
      .onConflictDoNothing()
      .returning();
    return made ?? (await this.db.select().from(agentApplications).where(eq(agentApplications.userId, userId)))[0]!;
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

  /** The checklist as the agent app shows it. Checks still running are asked about again here. */
  async view(userId: string) {
    let app = await this.load(userId);
    if (app.status === 'checking') app = await this.refresh(app);
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

  private editable(app: Application) {
    if (app.status !== 'draft') {
      throw conflict('application_submitted', 'Your application is already sent. We will text you when it is checked.');
    }
  }

  async saveBasics(userId: string, input: { stateCode?: string; area?: string }) {
    const app = await this.load(userId);
    this.editable(app);
    if (input.stateCode) {
      const [state] = await this.db
        .select({ id: states.id })
        .from(states)
        .where(and(eq(states.countryCode, app.countryCode), eq(states.code, input.stateCode)));
      if (!state) throw badRequest('unknown_state', 'Choose a state from the list');
    }
    await this.db
      .update(agentApplications)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(agentApplications.userId, userId));
    return this.view(userId);
  }

  /**
   * Starts the NIN, BVN and selfie checks with the provider. The numbers go to the provider and are not
   * kept; only the NIN's fingerprint is, so the same NIN can't be used for a second agent account.
   */
  async startIdentity(userId: string, input: { nin: string; bvn: string }) {
    const app = await this.load(userId);
    this.editable(app);
    const nin = normaliseIdNumber('nin', input.nin);
    const bvn = normaliseIdNumber('bvn', input.bvn);
    if (!nin) throw badRequest('invalid_nin', 'A NIN is 11 digits');
    if (!bvn) throw badRequest('invalid_bvn', 'A BVN is 11 digits');
    const person = await this.person(userId);
    const fingerprint = this.fingerprint(nin);
    const [other] = await this.db
      .select({ userId: agentApplications.userId })
      .from(agentApplications)
      .where(and(eq(agentApplications.ninFingerprint, fingerprint), ne(agentApplications.userId, userId)));
    if (other) throw conflict('nin_in_use', 'This NIN is already used by another agent account. Contact support.');
    const started = await this.provider(() => this.identity.startIdentity({ person, nin, bvn }));
    await this.db
      .update(agentApplications)
      .set({
        ninFingerprint: fingerprint,
        identityReference: started.reference,
        identityOutcome: null,
        identityCheckedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(agentApplications.userId, userId));
    return { sdkToken: started.sdkToken, provider: this.identity.name };
  }

  /** After the provider's SDK finishes in the app: reads the result from the provider and keeps it. */
  async finishIdentity(userId: string) {
    const app = await this.load(userId);
    this.editable(app);
    if (!app.identityReference) throw conflict('identity_not_started', 'Start with your NIN and BVN');
    const result = await this.provider(() => this.identity.identityResult(app.identityReference!));
    if (result.status === 'pending') return { status: 'pending' as const };
    const others = app.checks.filter((c) => !['nin', 'bvn', 'selfie'].includes(c.key));
    await this.db
      .update(agentApplications)
      .set({
        identityOutcome: result.outcome!,
        identityCheckedAt: new Date(),
        legalName: result.legalName ?? null,
        dateOfBirth: result.dateOfBirth ?? null,
        checks: [...result.checks, ...others],
        updatedAt: new Date(),
      })
      .where(eq(agentApplications.userId, userId));
    return { status: 'done' as const, outcome: result.outcome, checks: result.checks };
  }

  async saveAddress(
    userId: string,
    input: { address: string; emergency: { name: string; phone: string; relationship?: string } },
  ) {
    const app = await this.load(userId);
    this.editable(app);
    await this.db
      .update(agentApplications)
      .set({
        address: input.address,
        emergencyName: input.emergency.name,
        emergencyPhone: input.emergency.phone,
        emergencyRelationship: input.emergency.relationship ?? null,
        updatedAt: new Date(),
      })
      .where(eq(agentApplications.userId, userId));
    return this.view(userId);
  }

  async acceptTerms(userId: string) {
    const app = await this.load(userId);
    this.editable(app);
    await this.db
      .update(agentApplications)
      .set({ termsAcceptedAt: new Date(), updatedAt: new Date() })
      .where(eq(agentApplications.userId, userId));
    return this.view(userId);
  }

  /** Sends the application: every step must be done. The address check starts now; the rest is decided after. */
  async submit(userId: string) {
    const view = await this.view(userId);
    const app = await this.load(userId);
    this.editable(app);
    const missing = Object.entries(view.steps)
      .filter(([, done]) => !done)
      .map(([step]) => step);
    if (missing.length) throw unprocessable('application_incomplete', 'Finish every step first', { missing });
    if (view.waitlisted) throw conflict('waitlisted', `Agent sign-ups in ${view.stateName} are on a waitlist for now`);
    const person = await this.person(userId);
    const started = await this.provider(() =>
      this.identity.startAddress({ person, address: app.address!, state: view.stateName ?? app.stateCode ?? '' }),
    );
    const [sent] = await this.db
      .update(agentApplications)
      .set({ status: 'checking', submittedAt: new Date(), addressReference: started.reference, updatedAt: new Date() })
      .where(and(eq(agentApplications.userId, userId), eq(agentApplications.status, 'draft')))
      .returning();
    if (!sent) throw conflict('application_submitted', 'Your application is already sent');
    await this.refresh(sent);
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
      return app;
    }
    if (address.status === 'pending') return app;
    const [payout] = await this.db
      .select({ accountName: payoutAccounts.accountName })
      .from(payoutAccounts)
      .where(and(eq(payoutAccounts.userId, app.userId), isNull(payoutAccounts.replacedAt)));
    const [user] = await this.db.select().from(users).where(eq(users.id, app.userId));
    const fullName = `${user!.firstName ?? ''} ${user!.lastName ?? ''}`;
    const legal = app.legalName ?? '';
    const own = app.checks.filter((c) => ['nin', 'bvn', 'selfie'].includes(c.key));
    const pass = (ok: boolean, note?: string): { outcome: CheckOutcome; note?: string } =>
      ok ? { outcome: 'passed' } : { outcome: 'review', note };
    const checks: Check[] = [
      ...own,
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
        ...pass(!!legal && namesWithin(fullName, legal), 'The name in the app differs from the NIN record'),
      },
      { key: 'address', outcome: address.outcome!, ...(address.note ? { note: address.note } : {}) },
      {
        key: 'bank',
        ...pass(
          !!payout && !!legal && namesWithin(fullName, payout.accountName),
          'The bank account is in another name',
        ),
      },
    ];
    // Passed only when every check passed; anything else waits for support, who decide. Nobody is turned
    // away by a machine.
    const approved = checks.every((c) => c.outcome === 'passed');
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
