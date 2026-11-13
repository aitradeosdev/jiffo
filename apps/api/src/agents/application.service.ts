import { Injectable, Inject, Logger } from '@nestjs/common';
import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import { createHmac, hkdfSync, randomUUID } from 'node:crypto';
import { safeEqual } from '../common/crypto';
import { normaliseIdNumber, providerInfo, yearsOld } from '@jiffo/shared';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { DB, type Db, type Tx } from '../db/database.module';
import { agentApplications, agentPresence, agentProfiles, payoutAccounts, states, users } from '../db/schema';
import {
  IdentityUnavailable,
  type IdentityResult,
  type PageInput,
  UnconfiguredIdentityAdapter,
  type CheckOutcome,
  type IdentityAdapter,
} from '../adapters/identity';
import { ProvidersService } from '../providers/providers.service';
import { IdentityPageError, IdentityProviderError } from '../adapters/identity-providers';
import { badRequest, conflict, forbidden, notFound, tooMany, unavailable, unprocessable } from '../common/errors';
import { nameWords } from '../common/names';
import { PushService } from '../push/push.service';
import { CountriesService } from '../countries/countries.service';

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
/** The identity checks a provider can answer. */
const IDENTITY_CHECKS = ['nin', 'bvn', 'selfie'];
/**
 * Needed for approval: the NIN and a selfie matching its photo, and the BVN when the app sent one (a provider
 * with its own page asks for the NIN only). Any BVN check that came back must pass too.
 */
const requiredChecks = (flow: IdentityAdapter['flow']) => (flow === 'hosted' ? ['nin', 'selfie'] : IDENTITY_CHECKS);
/** How many times an hour one check's page may be opened: each may start a paid session. */
const PAGE_OPENS_PER_HOUR = 20;
const HOUR_MS = 3_600_000;
/** While checking, the provider is asked again at most this often, however often the app looks. */
const POLL_EVERY_MS = 15_000;

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
  /** When each check's page was opened in the last hour, in this process. */
  private readonly pageOpens = new Map<string, number[]>();
  /** Checks whose page is being sent now, in this process. */
  private readonly submitting = new Set<string>();
  /** Its own key, derived from PIN_KEY, used only to fingerprint NINs. */
  private readonly ninKey: Buffer;

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly providers: ProvidersService,
    @Inject(APP_CONFIG) config: AppConfig,
    private readonly push: PushService,
    private readonly countries: CountriesService,
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

  /**
   * The provider a check was started with. If it is no longer set up, the check can't be finished there;
   * that is said as identity checks being unavailable, and support can look at the application.
   */
  private startedWith(name: string | null): IdentityAdapter {
    return (name ? this.providers.named('identity', name) : null) ?? new UnconfiguredIdentityAdapter();
  }

  /** Calls the provider, turning "no provider set up" into an answer the app can show. */
  private async provider<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      if (error instanceof IdentityProviderError) {
        this.logger.warn(`Identity provider: ${error.message}`);
        throw unavailable('identity_failed', "The identity check couldn't start. Try again in a moment.");
      }
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
    const identity = this.providers.current('identity');
    return {
      status: app.status,
      steps,
      /** "hosted": the identity provider's own page asks for the NIN, so the app opens it instead. */
      identityFlow: identity.flow,
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
      legalName: app.legalName,
      checks: app.checks.map((c) => ({ ...c, label: CHECK_LABELS[c.key] ?? c.key })),
      submittedAt: app.submittedAt,
      /** Who runs the checks, as the app names them, and how soon support usually looks at one in review. */
      provider: settings.identity.provider ?? providerInfo('identity', identity.name)?.name ?? null,
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
   * Starts the NIN, BVN and selfie checks with the provider. The numbers go to the provider and are not kept.
   * The NIN's fingerprint waits as pending: it is claimed only once the provider confirms the NIN is theirs.
   */
  async startIdentity(userId: string, input: { nin?: string; bvn?: string }) {
    // The provider in use now: the check finishes with it, even if admin switches in between.
    const identity = this.providers.current('identity');
    // A provider with its own page asks for the numbers there; otherwise the app sends them.
    let nin: string | null = null;
    let bvn: string | null = null;
    if (identity.flow === 'numbers') {
      nin = normaliseIdNumber('nin', input.nin ?? '');
      bvn = normaliseIdNumber('bvn', input.bvn ?? '');
      if (!nin) throw badRequest('invalid_nin', 'A NIN is 11 digits');
      if (!bvn) throw badRequest('invalid_bvn', 'A BVN is 11 digits');
    }
    const app = await this.load(userId);
    if (app.status !== 'draft') {
      throw conflict('application_submitted', 'Your application is already sent. We will text you when it is checked.');
    }
    const person = await this.person(userId);
    const reference = `jid-${randomUUID()}`;
    const started = await this.provider(() =>
      identity.startIdentity({ person, reference, ...(nin && bvn ? { nin, bvn } : {}) }),
    );
    await this.updateDraft(userId, {
      pendingNinFingerprint: nin ? this.fingerprint(nin) : null,
      identityProvider: identity.name,
      identityReference: started.reference,
      identityOutcome: null,
      identityCheckedAt: null,
    });
    return { sdkToken: started.sdkToken ?? null, url: started.url ?? null, provider: identity.name };
  }

  /**
   * A provider sending a result for a check started on its page: once its signature shows it came from them,
   * the application it belongs to is settled with it straight away. Only what settling keeps is kept (the
   * outcome, legal name, date of birth and the NIN's fingerprint), never the payload. Null when unsigned.
   */
  async recordWebhook(provider: string, rawBody: Buffer, headers: Record<string, string | string[] | undefined>) {
    const adapter = this.providers.named('identity', provider);
    const parse = adapter?.parseWebhook?.bind(adapter);
    if (!parse) return null;
    // A provider that can't be reached to confirm the result answers 503, so it sends the result again.
    const parsed = await this.provider(() => parse(rawBody, headers));
    if (!parsed) return null;
    const { reference, result } = parsed;
    if (result.status !== 'done') return { reference, settled: false };
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
    // A check started again since, or already settled: this result is no longer wanted.
    if (!app) return { reference, settled: false };
    return { reference, settled: (await this.applyIdentity(app, result)) !== null };
  }

  /** Whether a link to a provider's page is one this API made. */
  private signedLink(provider: string, reference: string, signature: string) {
    return safeEqual(signature, this.providers.context.sign(`${provider}:${reference}`));
  }

  /** The application waiting on a check started with this provider and reference, if any. */
  private async waitingOn(provider: string, reference: string) {
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
    return app ?? null;
  }

  /**
   * The page a provider's widget runs in, for a link this API made and a check still waiting on it: null for
   * any other link, "finished" for a check that is done or was started again. Opening one may start a paid
   * session with the provider, so each check's page opens a limited number of times an hour.
   */
  async hostedPage(provider: string, reference: string, signature: string): Promise<string | 'finished' | null> {
    const adapter = this.providers.named('identity', provider);
    if (!adapter?.page || !this.signedLink(provider, reference, signature)) return null;
    if (!(await this.waitingOn(provider, reference))) return 'finished';
    const now = Date.now();
    for (const [key, opens] of this.pageOpens) {
      if (opens.every((at) => now - at > HOUR_MS)) this.pageOpens.delete(key);
    }
    const opens = (this.pageOpens.get(reference) ?? []).filter((at) => now - at <= HOUR_MS);
    if (opens.length >= PAGE_OPENS_PER_HOUR) {
      throw tooMany('identity_page_limit', 'This page was opened too many times. Try again in an hour.');
    }
    this.pageOpens.set(reference, [...opens, now]);
    const page = adapter.page.bind(adapter);
    return this.provider(async () => page(reference));
  }

  /**
   * What the agent sent from a provider's page that Jiffo serves: the check runs with it, and its result
   * settles the application at once. The NIN is passed to the provider and only its fingerprint is kept.
   * One at a time per check, so a second send can't start a second paid check.
   */
  async submitPage(provider: string, input: PageInput & { ref: string; sig: string }) {
    const adapter = this.providers.named('identity', provider);
    if (!adapter?.submitPage || !this.signedLink(provider, input.ref, input.sig)) return null;
    const nin = normaliseIdNumber('nin', input.nin);
    if (!nin) throw badRequest('invalid_nin', 'A NIN is 11 digits');
    const finished = () =>
      conflict('identity_changed', 'This check is finished or was started again. Go back to the app.');
    const app = await this.waitingOn(provider, input.ref);
    if (!app) throw finished();
    if (this.submitting.has(input.ref)) throw conflict('identity_busy', 'This check is already being sent.');
    this.submitting.add(input.ref);
    try {
      let result: IdentityResult;
      try {
        result = await adapter.submitPage(input.ref, { nin, session: input.session, sessionSig: input.sessionSig });
      } catch (error) {
        if (error instanceof IdentityPageError) throw badRequest('identity_page', error.message);
        if (error instanceof IdentityProviderError) {
          this.logger.warn(`Identity provider: ${error.message}`);
          throw unavailable('identity_failed', `The check didn't go through. Send it again in a moment.`);
        }
        if (error instanceof IdentityUnavailable) {
          throw unavailable('identity_unavailable', "Identity checks aren't available yet.");
        }
        throw error;
      }
      const settled = await this.applyIdentity(app, result);
      if (!settled) throw finished();
      return { status: settled.status, outcome: settled.outcome };
    } finally {
      this.submitting.delete(input.ref);
    }
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
    // Already settled, as when the provider sent the result to its webhook.
    if (app.identityOutcome) {
      const checks = app.checks.filter((c) => [...IDENTITY_CHECKS, 'duplicate'].includes(c.key));
      return { status: 'done' as const, outcome: app.identityOutcome, checks };
    }
    return this.settleIdentity(app);
  }

  /** Asks the provider for the identity result, and keeps it once it is back. */
  private async settleIdentity(app: Application) {
    const result = await this.provider(() =>
      this.startedWith(app.identityProvider).identityResult(app.identityReference!),
    );
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
      const checks = now.checks.filter((c) => [...IDENTITY_CHECKS, 'duplicate'].includes(c.key));
      return { status: 'done' as const, outcome: now.identityOutcome, checks };
    }
    throw conflict('identity_changed', 'Your identity check was started again. Finish that one.');
  }

  /**
   * Keeps a finished identity result on the application, if it is still the check the application waits for.
   * When the NIN and selfie show the NIN is this person's, its fingerprint is claimed; if another agent
   * account already holds it, the identity goes to support rather than answering who owns which NIN.
   * Otherwise the fingerprint waits as pending, so support's approval claims it, or finds it already held.
   */
  private async applyIdentity(app: Application, result: IdentityResult) {
    const userId = app.userId;
    // The NIN's fingerprint: of the NIN the provider read, when its own page asked; else of what the app sent.
    const read = result.idNumber ? normaliseIdNumber('nin', result.idNumber) : null;
    const fingerprint = read ? this.fingerprint(read) : app.pendingNinFingerprint;
    const passed = (key: string) => result.checks.some((c) => c.key === key && c.outcome === 'passed');
    const own = passed('nin') && passed('selfie');
    return this.db.transaction(async (tx) => {
      let outcome: CheckOutcome = result.outcome ?? 'review';
      const checks: Check[] = [...result.checks];
      let claim: string | null = null;
      if (own && fingerprint) {
        // One claim at a time per NIN, so two accounts can't both take it at the same moment.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'nin:' + fingerprint}))`);
        const [holder] = await tx
          .select({ userId: agentApplications.userId })
          .from(agentApplications)
          .where(and(eq(agentApplications.ninFingerprint, fingerprint), ne(agentApplications.userId, userId)));
        if (holder) {
          checks.push({ key: 'duplicate', outcome: 'review', note: 'Another agent account uses this NIN' });
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
          legalName: result.legalName ?? null,
          dateOfBirth: result.dateOfBirth ?? null,
          // Only a NIN this check showed to be theirs is held; an earlier one is let go.
          ninFingerprint: claim,
          pendingNinFingerprint: claim ? null : fingerprint,
          checks: [...checks, ...app.checks.filter((c) => ![...IDENTITY_CHECKS, 'duplicate'].includes(c.key))],
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
    const identity = this.providers.current('identity');
    try {
      ({ reference } = await this.provider(() =>
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
      address = await this.provider(() => this.startedWith(app.addressProvider).addressResult(app.addressReference!));
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
    // The checks the provider was asked for must be there and passed, any other that came back too, and the
    // provider's overall answer. A provider no longer set up is taken to have been asked for all of them.
    const required = requiredChecks(this.startedWith(app.identityProvider).flow);
    const identityChecks: Check[] = IDENTITY_CHECKS.flatMap((key) => {
      const found = own.find((c) => c.key === key);
      if (found) return [found];
      return required.includes(key) ? [{ key, outcome: 'review', note: 'No result from the provider' }] : [];
    });
    const pass = (ok: boolean, note: string): { outcome: CheckOutcome; note?: string } =>
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
    let ninFingerprint = app.ninFingerprint;
    if (!ninFingerprint && app.pendingNinFingerprint) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'nin:' + app.pendingNinFingerprint}))`);
      const [holder] = await tx
        .select({ userId: agentApplications.userId, status: agentApplications.status })
        .from(agentApplications)
        .where(
          and(
            eq(agentApplications.ninFingerprint, app.pendingNinFingerprint),
            ne(agentApplications.userId, input.userId),
          ),
        );
      if (holder?.status === 'approved') {
        throw conflict('nin_held', 'Another approved agent account uses this NIN', { userId: holder.userId });
      }
      // An account that isn't approved lets the NIN go to the one support approves.
      if (holder) {
        await tx
          .update(agentApplications)
          .set({ ninFingerprint: null, updatedAt: new Date() })
          .where(eq(agentApplications.userId, holder.userId));
      }
      ninFingerprint = app.pendingNinFingerprint;
    }
    const [row] = await tx
      .update(agentApplications)
      .set({ status: 'approved', ninFingerprint, ...decided })
      .where(eq(agentApplications.userId, input.userId))
      .returning();
    return { before: app, after: row! };
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
