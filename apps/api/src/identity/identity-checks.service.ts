import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHmac, hkdfSync, randomBytes, randomUUID } from 'node:crypto';
import { and, eq, gt, lt, sql } from 'drizzle-orm';
import { ID_TYPES, normaliseIdNumber, providerInfo, type CountrySettings, type IdType } from '@jiffo/shared';
import {
  IdentityUnavailable,
  UnconfiguredIdentityAdapter,
  type CheckOutcome,
  type IdentityAdapter,
  type IdentityPerson,
  type IdentityRequest,
  type IdentityResult,
  type PageInput,
  REFERENCE_PREFIX,
} from '../adapters/identity';
import { IdentityPageError, IdentityProviderError } from '../adapters/identity-providers';
import { SessionVerifier } from '../auth/auth.guard';
import { safeEqual, sha256 } from '../common/crypto';
import { ApiError, badRequest, conflict, gone, tooMany, unavailable } from '../common/errors';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { DB, type Db } from '../db/database.module';
import { identityAttempts, webhookSignatures } from '../db/schema';
import { ProvidersService } from '../providers/providers.service';

export type IdentityRole = 'customer' | 'agent';
export type Check = { key: string; outcome: string; note?: string };

/** A check started with a provider, as the account it belongs to keeps it. */
export interface PendingCheck {
  userId: string;
  provider: string;
  reference: string;
  request: IdentityRequest;
  /** The app session it was started from; null for checks started before this was kept. */
  sessionId: string | null;
}

/** A hosted page as the controller serves it: the HTML, and the cookie its browser keeps it with. */
export interface HostedPage {
  html: string;
  /** Set on the first open: the browser the link now works in. */
  binding?: string;
}

/** A finished check, judged: its checks filed under the ID's type, and the ID's fingerprint. */
export interface JudgedResult {
  outcome: CheckOutcome;
  idType: IdType;
  checks: Check[];
  legalName: string | null;
  dateOfBirth: string | null;
  /** Of the ID the provider read, when it gave the number; else null (the account's pending one stands). */
  fingerprint: string | null;
  /** The NIN, BVN or other ID and the selfie all passed: the ID is shown to be this person's. */
  own: boolean;
}

/** Customers' and agents' checks, each kept where its account keeps it. */
export interface IdentityOwner {
  /** The check waiting on this provider and reference, if any. */
  waiting(provider: string, reference: string): Promise<PendingCheck | null>;
  /** Keeps a finished result, if the check is still waited on; null when it isn't. */
  settle(check: PendingCheck, result: IdentityResult): Promise<{ outcome: CheckOutcome } | null>;
}

const PREFIX: Record<IdentityRole, string> = REFERENCE_PREFIX;
/** What each ID check says, in words for the person checked; each side adds its own for the rest. */
export const ID_CHECK_LABELS: Record<string, string> = {
  nin: 'NIN matches your details',
  bvn: 'BVN matches your details',
  drivers_licence: "Driver's licence matches your details",
  voters_card: "Voter's card matches your details",
  passport: 'Passport matches your details',
  id_type: 'An ID we accept',
  selfie: 'Selfie matches your ID photo',
  age: 'Age 18 or older',
};
/** How many times an hour one check's page may be opened: each may start a paid session. */
const PAGE_OPENS_PER_HOUR = 20;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** Attempts and webhook signatures are kept this long: well past any limit or provider's age check. */
const KEPT_MS = 2 * DAY_MS;
const OPENED_ELSEWHERE = 'This link was opened on another device. Start the check again from the app.';

/**
 * A hosted page couldn't be made (the provider down, or opened too often). The browser still gets the cookie
 * if this was the open that bound the link to it.
 */
export class HostedPageFailure extends Error {
  constructor(
    readonly error: ApiError,
    readonly binding?: string,
  ) {
    super(error.message);
  }
}

/**
 * Identity checks with the provider switched on in the panel, for customers and agents alike: which IDs a
 * check can use, starting it, reading its result, and what providers send back (webhooks, and the pages
 * Jiffo serves for them). Each account keeps its own check; this finds it by the reference.
 */
@Injectable()
export class IdentityChecksService {
  private readonly logger = new Logger(IdentityChecksService.name);
  private readonly owners = new Map<string, IdentityOwner>();
  /** Checks whose page is being sent now, in this process. */
  private readonly submitting = new Set<string>();
  /** Its own key, derived from PIN_KEY, used only to fingerprint IDs (named for the NIN, its first ID). */
  private readonly idKey: Buffer;

  constructor(
    private readonly providers: ProvidersService,
    private readonly sessions: SessionVerifier,
    @Inject(DB) private readonly db: Db,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.idKey = Buffer.from(
      hkdfSync('sha256', Buffer.from(config.PIN_KEY, 'hex'), Buffer.alloc(0), 'jiffo nin fingerprint', 32),
    );
  }

  register(role: IdentityRole, owner: IdentityOwner) {
    this.owners.set(PREFIX[role], owner);
  }

  private ownerOf(reference: string) {
    return this.owners.get(reference.split('-')[0] ?? '') ?? null;
  }

  /**
   * HMAC of an ID's type and number: the same ID gives the same fingerprint, and can't be read back. A NIN's
   * is of the number alone, as before other IDs, so fingerprints kept then still match; the others name
   * their type, which a NIN (digits only) never can.
   */
  fingerprint(idType: IdType, number: string) {
    return createHmac('sha256', this.idKey)
      .update(idType === 'nin' ? number : `${idType}:${number}`)
      .digest('hex');
  }

  /** The provider switched on now, for a new check. */
  current(): IdentityAdapter {
    return this.providers.current('identity');
  }

  /**
   * The provider a check was started with. If it is no longer set up, the check can't be finished there;
   * that is said as identity checks being unavailable, and support can look at it.
   */
  startedWith(name: string | null): IdentityAdapter {
    return (name ? this.providers.named('identity', name) : null) ?? new UnconfiguredIdentityAdapter();
  }

  /** Calls the provider, turning its failures into answers the apps can show. */
  async call<T>(
    call: () => Promise<T>,
    failed = "The identity check couldn't start. Try again in a moment.",
  ): Promise<T> {
    try {
      return await call();
    } catch (error) {
      if (error instanceof IdentityProviderError) {
        this.logger.warn(`Identity provider: ${error.message}`);
        throw unavailable('identity_failed', failed);
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
   * What a new check can be, with the provider in use now: the IDs admin accepts that it checks, and whether
   * an agent's BVN is checked as well. A provider that can't check a BVN alongside another ID takes it as
   * the ID itself.
   */
  options(role: IdentityRole, settings: CountrySettings['identity']) {
    const adapter = this.providers.current('identity');
    const accepted: readonly IdType[] = role === 'customer' ? settings.customerIdTypes : settings.agentIdTypes;
    const withBvn = role === 'agent' && settings.requireBvnForAgents;
    let idTypes = accepted.filter((t) => adapter.idTypes.includes(t));
    if (withBvn && !adapter.bvnAlongside) idTypes = adapter.idTypes.includes('bvn') ? ['bvn'] : [];
    // The IDs a result may be for: those admin accepts, and the BVN when the BVN rule made it the ID.
    const acceptedIds = this.accepted(role, settings, adapter.name);
    return {
      adapter,
      idTypes,
      acceptedIds,
      withBvn,
      flow: adapter.flow,
      idChosenOnPage: adapter.idChosenOnPage,
      /** The provider's name as people read it; none for the development stand-in. */
      providerName: providerInfo('identity', adapter.name)?.name ?? null,
    };
  }

  /**
   * The IDs a finished check may be for, with the provider it was started with: those admin accepts, and the
   * BVN when the BVN rule made it an agent's ID because that provider can't check it alongside another.
   */
  accepted(role: IdentityRole, settings: CountrySettings['identity'], provider: string): IdType[] {
    const accepted: readonly IdType[] = role === 'customer' ? settings.customerIdTypes : settings.agentIdTypes;
    const forced = role === 'agent' && settings.requireBvnForAgents && !this.startedWith(provider).bvnAlongside;
    return forced && !accepted.includes('bvn') ? [...accepted, 'bvn'] : [...accepted];
  }

  /**
   * Starts a check. The ID number (and BVN) come only when the app asks for them; they are passed to the
   * provider and never kept. Gives the reference, the request as started, and the pending fingerprint.
   */
  async start(
    role: IdentityRole,
    person: IdentityPerson,
    settings: CountrySettings['identity'],
    input: { idType?: string; idNumber?: string; bvn?: string },
    userId: string,
  ) {
    const options = this.options(role, settings);
    const { adapter } = options;
    if (adapter.name === 'none' || !options.idTypes.length) {
      throw unavailable(
        'identity_unavailable',
        "Checks for the IDs we accept aren't available yet. We'll text you when they are.",
      );
    }
    // On a provider whose page offers the IDs, the person picks there; the first accepted one stands in.
    // Earlier versions of the apps send no ID type: they meant the NIN, or the only ID on offer.
    const wanted =
      input.idType ??
      (options.idTypes.includes('nin') ? 'nin' : options.idTypes.length === 1 ? options.idTypes[0] : undefined);
    const idType = options.idChosenOnPage
      ? options.idTypes[0]!
      : (options.idTypes.find((t) => t === wanted) ??
        (() => {
          throw badRequest('invalid_id_type', 'Choose one of the IDs we accept');
        })());
    const request: IdentityRequest = { role, idType, withBvn: options.withBvn };
    let idNumber: string | undefined;
    let bvn: string | undefined;
    if (adapter.flow === 'numbers') {
      idNumber = normaliseIdNumber(idType, input.idNumber ?? '') ?? undefined;
      if (!idNumber) throw badRequest('invalid_id', `Check your ${ID_TYPES[idType].name} number`);
      if (request.withBvn && idType !== 'bvn') {
        bvn = normaliseIdNumber('bvn', input.bvn ?? '') ?? undefined;
        if (!bvn) throw badRequest('invalid_bvn', 'A BVN is 11 digits');
      }
    }
    const reference = `${PREFIX[role]}-${randomUUID()}`;
    const attempt = await this.countStart(userId, reference, settings.checkStartsPerDay);
    let started: Awaited<ReturnType<IdentityAdapter['startIdentity']>>;
    try {
      started = await this.call(() => adapter.startIdentity({ person, reference, request, idNumber, bvn }));
    } catch (error) {
      // The provider didn't take it, so it cost nothing and looked nothing up: it doesn't count.
      await this.db.delete(identityAttempts).where(eq(identityAttempts.id, attempt));
      throw error;
    }
    return {
      reference: started.reference,
      provider: adapter.name,
      request,
      sdkToken: started.sdkToken ?? null,
      url: started.url ?? null,
      pendingFingerprint: idNumber ? this.fingerprint(idType, idNumber) : null,
    };
  }

  /**
   * Counts a check towards the account's daily limit, or refuses it once the limit is reached. Each start
   * the provider takes may be a paid check, and one that finds an ID's record could be used to look people
   * up, so the limit holds whatever the outcome. One at a time per account, so a burst can't slip past the
   * count. Gives the attempt's ID, so a start the provider refused can be taken back.
   */
  private async countStart(userId: string, reference: string, perDay: number) {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'identity-start:' + userId}))`);
      const [made] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(identityAttempts)
        .where(
          and(
            eq(identityAttempts.kind, 'start'),
            eq(identityAttempts.userId, userId),
            gt(identityAttempts.createdAt, new Date(Date.now() - DAY_MS)),
          ),
        );
      if ((made?.n ?? 0) >= perDay) {
        throw tooMany(
          'identity_check_limit',
          'You have started too many ID checks today. Try again tomorrow, or contact support.',
        );
      }
      const [attempt] = await tx
        .insert(identityAttempts)
        .values({ kind: 'start', userId, reference })
        .returning({ id: identityAttempts.id });
      return attempt!.id;
    });
  }

  /** Forgets attempts and webhook signatures older than any limit looks at. Runs daily. */
  async prune() {
    const before = new Date(Date.now() - KEPT_MS);
    const attempts = await this.db
      .delete(identityAttempts)
      .where(lt(identityAttempts.createdAt, before))
      .returning({ id: identityAttempts.id });
    const signatures = await this.db
      .delete(webhookSignatures)
      .where(lt(webhookSignatures.seenAt, before))
      .returning({ provider: webhookSignatures.provider });
    return { attempts: attempts.length, signatures: signatures.length };
  }

  /** Asks the provider a check was started with for its result. */
  result(check: Pick<PendingCheck, 'provider' | 'reference'>) {
    return this.call(
      () => this.startedWith(check.provider).identityResult(check.reference),
      "The identity check couldn't be read. Try again in a moment.",
    );
  }

  /**
   * A provider's finished result, judged against what the check asked for: its checks filed under the ID's
   * type, any check asked for and not answered sent to review, and an ID the person chose on the provider's
   * page that admin doesn't accept sent to review too.
   */
  judge(request: IdentityRequest, result: IdentityResult, accepted: readonly IdType[]): JudgedResult {
    const idType = result.idType ?? request.idType;
    const checks: Check[] = result.checks.map((c) => ({ ...c, key: c.key === 'id' ? idType : c.key }));
    const asked = [idType, 'selfie', ...(request.withBvn && idType !== 'bvn' ? ['bvn'] : [])];
    for (const key of asked) {
      if (!checks.some((c) => c.key === key))
        checks.push({ key, outcome: 'review', note: 'No result from the provider' });
    }
    // The ID a check started with was on offer then; only one the person chose on the provider's page is
    // held against what admin accepts now.
    if (result.idType && !accepted.includes(idType)) {
      checks.push({
        key: 'id_type',
        outcome: 'review',
        note: `${ID_TYPES[idType].name} isn't one of the IDs we accept`,
      });
    }
    let outcome: CheckOutcome = result.outcome ?? 'review';
    if (outcome === 'passed' && checks.some((c) => c.outcome !== 'passed')) {
      outcome = checks.some((c) => c.outcome === 'failed') ? 'failed' : 'review';
    }
    const read = result.idNumber ? normaliseIdNumber(idType, result.idNumber) : null;
    const passed = (key: string) => checks.some((c) => c.key === key && c.outcome === 'passed');
    // The ID record's name and date of birth are kept only for a check that didn't fail: a failed selfie
    // must not turn the check into a way to look up whose ID a number is (docs/security-plan.md, I1).
    const keep = outcome !== 'failed';
    return {
      outcome,
      idType,
      checks,
      legalName: keep ? (result.legalName ?? null) : null,
      dateOfBirth: keep ? (result.dateOfBirth ?? null) : null,
      fingerprint: read ? this.fingerprint(idType, read) : null,
      own: passed(idType) && passed('selfie'),
    };
  }

  /** Whether a link to a provider's page is one this API made: "ok", "expired", or "bad" for any other. */
  private linkState(provider: string, reference: string, expires: string, signature: string) {
    if (!safeEqual(signature, this.providers.context.sign(`${provider}:${reference}:${expires}`))) return 'bad';
    const at = Number(expires);
    return Number.isFinite(at) && at > Date.now() ? 'ok' : 'expired';
  }

  /** Whether a send from a provider's page carries the signature that page was given. */
  private signedSubmit(provider: string, reference: string, signature: string) {
    return safeEqual(signature, this.providers.context.sign(`${provider}:${reference}`));
  }

  /** Whether the app session a check was started from is still signed in, on an active account. */
  private async sessionLive(check: PendingCheck) {
    if (!check.sessionId) return true;
    return (await this.sessions.liveSessions([check.sessionId])).has(check.sessionId);
  }

  /** Whether this browser is the one the check's page was first opened in. */
  private async boundHere(reference: string, cookie: string | undefined) {
    if (!cookie) return false;
    const [row] = await this.db
      .select({ id: identityAttempts.id })
      .from(identityAttempts)
      .where(
        and(
          eq(identityAttempts.kind, 'page_open'),
          eq(identityAttempts.reference, reference),
          eq(identityAttempts.binding, sha256(cookie)),
        ),
      )
      .limit(1);
    return !!row;
  }

  private async waitingOn(provider: string, reference: string) {
    const owner = this.ownerOf(reference);
    const check = owner ? await owner.waiting(provider, reference) : null;
    return check && owner ? { owner, check } : null;
  }

  /**
   * A provider sending a result for a check started on its page: once its signature shows it came from them,
   * the check it belongs to is settled with it straight away. Null when unsigned.
   */
  async recordWebhook(provider: string, rawBody: Buffer, headers: Record<string, string | string[] | undefined>) {
    const adapter = this.providers.named('identity', provider);
    const parse = adapter?.parseWebhook?.bind(adapter);
    if (!parse) return null;
    // A provider that can't be reached to confirm the result answers 503, so it sends the result again.
    const parsed = await this.call(() => parse(rawBody, headers));
    if (!parsed) return null;
    if (parsed.replayKey && !(await this.firstUse(provider, parsed.replayKey, rawBody))) return null;
    const { reference, result } = parsed;
    if (result.status !== 'done') return { reference, settled: false };
    // A check started again since, or already settled: this result is no longer wanted.
    const found = await this.waitingOn(provider, reference);
    if (!found) return { reference, settled: false };
    return { reference, settled: (await found.owner.settle(found.check, result)) !== null };
  }

  /**
   * For a provider whose signature doesn't cover the body (Smile ID): true the first time a signature is seen
   * for a job, or when it comes again with the same body (the provider resending it); false when it comes
   * with a different body, which only a replay could do.
   */
  private async firstUse(provider: string, replayKey: string, rawBody: Buffer) {
    const bodyHash = sha256(rawBody.toString('utf8'));
    await this.db.insert(webhookSignatures).values({ provider, signature: replayKey, bodyHash }).onConflictDoNothing();
    const [seen] = await this.db
      .select({ bodyHash: webhookSignatures.bodyHash })
      .from(webhookSignatures)
      .where(and(eq(webhookSignatures.provider, provider), eq(webhookSignatures.signature, replayKey)));
    if (seen?.bodyHash === bodyHash) return true;
    this.logger.warn(`A ${provider} webhook signature came again with a different body; refused`);
    return false;
  }

  /**
   * The page a provider's widget runs in, for a link this API made and a check still waiting on it: null for
   * any other link, "expired" for one past its time, "finished" for a check that is done or was started
   * again.
   * - The page works only while the app session that started the check is signed in.
   * - The first browser to open it keeps it: the link opened anywhere else is refused, so a forwarded link
   *   can't be used by someone else.
   * - Opening one may start a paid session with the provider, so each check's page opens a limited number of
   *   times an hour, counted across every server.
   * The binding and the count are decided in one step per check, so two browsers opening at once can't both
   * keep it.
   */
  async hostedPage(
    provider: string,
    link: { reference: string; expires: string; signature: string },
    cookie: string | undefined,
  ): Promise<HostedPage | 'expired' | 'finished' | null> {
    const adapter = this.providers.named('identity', provider);
    const { reference } = link;
    if (!adapter?.page) return null;
    const state = this.linkState(provider, reference, link.expires, link.signature);
    if (state !== 'ok') return state === 'expired' ? 'expired' : null;
    const found = await this.waitingOn(provider, reference);
    if (!found || !(await this.sessionLive(found.check))) return 'finished';
    const binding = await this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'identity-page:' + reference}))`);
      const [opens] = await tx
        .select({
          bound: sql<number>`count(*) filter (where ${identityAttempts.binding} is not null)::int`,
          here: sql<number>`count(*) filter (where ${identityAttempts.binding} = ${cookie ? sha256(cookie) : ''})::int`,
          recent: sql<number>`count(*) filter (where ${identityAttempts.createdAt} > ${new Date(Date.now() - HOUR_MS)})::int`,
        })
        .from(identityAttempts)
        .where(and(eq(identityAttempts.kind, 'page_open'), eq(identityAttempts.reference, reference)));
      if ((opens?.bound ?? 0) > 0 && !(opens?.here ?? 0)) throw gone('identity_opened_elsewhere', OPENED_ELSEWHERE);
      if ((opens?.recent ?? 0) >= PAGE_OPENS_PER_HOUR) {
        throw tooMany('identity_page_limit', 'This page was opened too many times. Try again in an hour.');
      }
      // The first open binds the link to this browser, before the page is made, as making it may start a
      // paid session; later opens from the same browser are counted too.
      const first = (opens?.bound ?? 0) === 0;
      const token = first ? (cookie ?? randomBytes(32).toString('hex')) : undefined;
      await tx.insert(identityAttempts).values({
        kind: 'page_open',
        userId: found.check.userId,
        reference,
        binding: token ? sha256(token) : null,
      });
      return token && token !== cookie ? token : undefined;
    });
    const page = adapter.page.bind(adapter);
    try {
      const html = await this.call(async () => page(reference, found.check.request));
      return binding ? { html, binding } : { html };
    } catch (error) {
      if (error instanceof ApiError) throw new HostedPageFailure(error, binding);
      throw error;
    }
  }

  /**
   * What the person sent from a provider's page that Jiffo serves: the check runs with it, and its result
   * settles the check at once. The numbers are passed to the provider and never kept. One at a time per
   * check, so a second send can't start a second paid check.
   */
  async submitPage(provider: string, input: PageInput & { ref: string; sig: string }, cookie: string | undefined) {
    const adapter = this.providers.named('identity', provider);
    if (!adapter?.submitPage || !this.signedSubmit(provider, input.ref, input.sig)) return null;
    const finished = () =>
      conflict('identity_changed', 'This check is finished or was started again. Go back to the app.');
    const found = await this.waitingOn(provider, input.ref);
    if (!found || !(await this.sessionLive(found.check))) throw finished();
    // Only from the browser the page was opened in.
    if (!(await this.boundHere(input.ref, cookie))) {
      throw gone('identity_opened_elsewhere', OPENED_ELSEWHERE);
    }
    const { idType, withBvn } = found.check.request;
    const idNumber = normaliseIdNumber(idType, input.idNumber);
    if (!idNumber) throw badRequest('invalid_id', `Check your ${ID_TYPES[idType].name} number`);
    const bvn = withBvn && idType !== 'bvn' ? normaliseIdNumber('bvn', input.bvn ?? '') : undefined;
    if (bvn === null) throw badRequest('invalid_id', 'A BVN is 11 digits');
    if (this.submitting.has(input.ref)) throw conflict('identity_busy', 'This check is already being sent.');
    this.submitting.add(input.ref);
    try {
      let result: IdentityResult;
      try {
        result = await adapter.submitPage(input.ref, found.check.request, {
          idNumber,
          bvn: bvn ?? undefined,
          session: input.session,
          sessionSig: input.sessionSig,
        });
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
      const settled = await found.owner.settle(found.check, result);
      if (!settled) throw finished();
      return { status: 'done' as const, outcome: settled.outcome };
    } finally {
      this.submitting.delete(input.ref);
    }
  }
}
