import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { and, desc, eq, inArray, lt, ne, sql } from 'drizzle-orm';
import {
  canRevealPin,
  nextState,
  serviceFee,
  type AgentTier,
  type CountrySettings,
  type ErrandEvent,
  type ErrandState,
} from '@jiffo/shared';
import type { z } from 'zod';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { DB, type Db, type Tx } from '../db/database.module';
import { errandEvents, errandStops, errands, users } from '../db/schema';
import { CountriesService } from '../countries/countries.service';
import type { AuthContext } from '../auth/auth.types';
import { decrypt, encrypt, numericCode, safeEqual } from '../common/crypto';
import { ApiError, badRequest, conflict, locked, notFound, unprocessable } from '../common/errors';
import { ERRAND_TIMERS, type ErrandTimerJob, type ErrandTimers } from '../timers/errand-timers';
import { CustomerFundsLow, WalletService } from '../money/wallet.service';
import { AgentsService } from '../agents/agents.service';
import { ErrandNotifier, type TransitionResult } from './errand-notifier';
import { EVENT_DATA, type CreateErrandInput, type ErrandEventInput } from './errand-input';
import {
  errandView,
  transitionContext,
  type ErrandRow,
  type PersonSummary,
  type StopRow,
  type ViewerRole,
} from './errand-view';

type Patch = Partial<typeof errands.$inferInsert>;

/** What an event changes beyond the status: `patch` is written with the transition, `record` goes in the event log. */
interface EventEffect {
  patch: Patch;
  record: Record<string, unknown>;
}

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

@Injectable()
export class ErrandsService implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(ERRAND_TIMERS) private readonly timers: ErrandTimers,
    private readonly countries: CountriesService,
    private readonly notifier: ErrandNotifier,
    private readonly wallet: WalletService,
    private readonly agents: AgentsService,
  ) {}

  onModuleInit() {
    this.timers.setHandler((job) => this.applyTimer(job));
  }

  /* ---------- Reading ---------- */

  private roleFor(errand: ErrandRow, auth: AuthContext): ViewerRole | null {
    if (auth.app === 'customer') return errand.customerId === auth.userId ? 'customer' : null;
    if (errand.agentId === auth.userId) return 'agent';
    const open = errand.status === 'requested' && errand.customerId !== auth.userId;
    if (open && errand.countryCode === auth.countryCode) return 'prospect';
    return null;
  }

  private async people(rows: ErrandRow[]) {
    const ids = [...new Set(rows.flatMap((r) => [r.customerId, r.agentId]).filter((id): id is string => !!id))];
    const found = ids.length
      ? await this.db.select({ id: users.id, firstName: users.firstName }).from(users).where(inArray(users.id, ids))
      : [];
    return new Map<string, PersonSummary>(found.map((u) => [u.id, u]));
  }

  private async views(rows: ErrandRow[], roleOf: (row: ErrandRow) => ViewerRole) {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const [stops, people] = await Promise.all([
      this.db.select().from(errandStops).where(inArray(errandStops.errandId, ids)),
      this.people(rows),
    ]);
    const stopsBy = new Map<string, StopRow[]>();
    for (const s of stops) stopsBy.set(s.errandId, [...(stopsBy.get(s.errandId) ?? []), s]);
    return rows.map((r) =>
      errandView(
        r,
        stopsBy.get(r.id) ?? [],
        { customer: people.get(r.customerId) ?? null, agent: r.agentId ? (people.get(r.agentId) ?? null) : null },
        roleOf(r),
      ),
    );
  }

  private async load(errandId: string, auth: AuthContext) {
    const [errand] = await this.db.select().from(errands).where(eq(errands.id, errandId));
    const role = errand ? this.roleFor(errand, auth) : null;
    if (!errand || !role) throw notFound('errand_not_found', 'Errand not found');
    return { errand, role };
  }

  async get(errandId: string, auth: AuthContext) {
    const { errand, role } = await this.load(errandId, auth);
    return this.viewOne(errand, role);
  }

  /** The caller's own errands: as the customer in the customer app, as the agent in the agent app. */
  async listMine(auth: AuthContext, before: Date | undefined, limit: number) {
    const mine = auth.app === 'customer' ? eq(errands.customerId, auth.userId) : eq(errands.agentId, auth.userId);
    const rows = await this.db
      .select()
      .from(errands)
      .where(and(mine, before ? lt(errands.createdAt, before) : undefined))
      .orderBy(desc(errands.createdAt))
      .limit(limit);
    return this.views(rows, () => (auth.app === 'customer' ? 'customer' : 'agent'));
  }

  /** Open errands whose pickup is within the radius, nearest first. */
  async board(auth: AuthContext, q: { lat: number; lng: number; radiusKm: number; limit: number }) {
    // Only errands in the agent's chosen categories, and purchase errands only if they take them.
    const prefs = await this.agents.profile(auth.userId);
    const here = sql`ST_SetSRID(ST_MakePoint(${q.lng}, ${q.lat}), 4326)::geography`;
    const distance = sql<number>`ST_Distance(${errandStops.location}, ${here})`;
    const rows = await this.db
      .select({ errand: errands, distanceMeters: distance })
      .from(errands)
      .innerJoin(errandStops, and(eq(errandStops.errandId, errands.id), eq(errandStops.seq, 0)))
      .where(
        and(
          eq(errands.status, 'requested'),
          eq(errands.countryCode, auth.countryCode),
          ne(errands.customerId, auth.userId),
          prefs.categoryKeys ? inArray(errands.categoryKey, prefs.categoryKeys) : undefined,
          prefs.takesPurchases ? undefined : eq(errands.buy, false),
          sql`ST_DWithin(${errandStops.location}, ${here}, ${q.radiusKm * 1000})`,
        ),
      )
      .orderBy(distance)
      .limit(q.limit);
    const views = await this.views(
      rows.map((r) => r.errand),
      () => 'prospect',
    );
    return views.map((v, i) => ({ ...v, distanceMeters: Math.round(Number(rows[i]!.distanceMeters)) }));
  }

  async events(errandId: string, auth: AuthContext) {
    const { role } = await this.load(errandId, auth);
    if (role === 'prospect') throw notFound('errand_not_found', 'Errand not found');
    const rows = await this.db
      .select()
      .from(errandEvents)
      .where(eq(errandEvents.errandId, errandId))
      .orderBy(errandEvents.id);
    return rows.map((e) => ({
      id: e.id,
      event: e.event,
      fromStatus: e.fromStatus,
      toStatus: e.toStatus,
      actorRole: e.actorRole,
      data: e.data,
      createdAt: e.createdAt,
    }));
  }

  /** The customer's hand-off PIN. Shown only once the agent has marked the errand delivered. */
  async pin(errandId: string, auth: AuthContext) {
    const { errand, role } = await this.load(errandId, auth);
    if (role !== 'customer') throw notFound('errand_not_found', 'Errand not found');
    if (!canRevealPin(errand.status) || !errand.pinCipher) {
      throw conflict('pin_not_available', 'Your PIN shows once the agent marks the errand delivered');
    }
    return { pin: decrypt(this.config.PIN_KEY, errand.pinCipher) };
  }

  /* ---------- Creating ---------- */

  async create(auth: AuthContext, input: CreateErrandInput) {
    const [customer] = await this.db.select().from(users).where(eq(users.id, auth.userId));
    if (!customer?.firstName) throw conflict('profile_incomplete', 'Add your name before sending an errand');
    const country = customer.countryCode;
    const [{ version, settings }, state, category] = await Promise.all([
      this.countries.currentSettings(country),
      this.countries.enabledState(country, input.stateCode),
      this.countries.activeCategory(country, input.categoryKey),
    ]);
    if (!state) throw unprocessable('state_not_available', 'Jiffo is not available in this state yet');
    if (!category) throw unprocessable('category_not_available', 'This category is not available');
    if (input.feeKobo < settings.pricing.minFeeKobo) {
      throw unprocessable('fee_too_low', 'The fee is below the minimum', { minFeeKobo: settings.pricing.minFeeKobo });
    }
    if (input.scheduledFor && input.scheduledFor.getTime() < Date.now() + 15 * MINUTE_MS) {
      throw unprocessable('schedule_too_soon', 'Schedule at least 15 minutes ahead, or send it now');
    }
    // Nothing is held until an agent accepts, but the wallet must cover the errand before it goes out.
    const serviceFeeKobo = serviceFee(input.feeKobo, settings.fees);
    const balanceKobo = await this.wallet.customerBalance(customer.id, country);
    if (balanceKobo < input.feeKobo + serviceFeeKobo) {
      throw conflict('insufficient_funds', 'Top up your wallet to send this errand', {
        neededKobo: input.feeKobo + serviceFeeKobo,
        balanceKobo,
      });
    }

    const created = await this.db.transaction(async (tx) => {
      const [errand] = await tx
        .insert(errands)
        .values({
          countryCode: country,
          stateCode: state.code,
          customerId: customer.id,
          categoryKey: category.key,
          buy: input.buy ?? category.buyDefault,
          urgent: input.urgent,
          description: input.description,
          status: 'requested',
          feeKobo: input.feeKobo,
          serviceFeeKobo,
          scheduledFor: input.scheduledFor ?? null,
          settingsVersion: version,
        })
        .returning();
      await tx.insert(errandStops).values(
        input.stops.map((s, seq) => ({
          errandId: errand!.id,
          seq,
          kind: s.kind,
          label: s.label ?? null,
          address: s.address,
          lat: s.lat,
          lng: s.lng,
          location: sql`ST_SetSRID(ST_MakePoint(${s.lng}, ${s.lat}), 4326)::geography`,
        })),
      );
      await tx.insert(errandEvents).values({
        errandId: errand!.id,
        event: 'create',
        fromStatus: null,
        toStatus: 'requested',
        actorRole: 'customer',
        actorId: customer.id,
      });
      await this.scheduleTimers(errand!, settings);
      return errand!;
    });

    return this.viewOne(created, 'customer');
  }

  /* ---------- Changing ---------- */

  /**
   * The settings an errand runs under. Its country and settings version never change, so this is read
   * before the transaction: a query on the pool while holding a locked connection could starve the pool.
   */
  /**
   * The errand's settings and currency, and the tier its money follows: the tier of the agent accepting
   * now, or the tier recorded when the current agent accepted.
   */
  private async settingsOf(errandId: string, acceptingAgentId?: string) {
    const [row] = await this.db
      .select({
        countryCode: errands.countryCode,
        settingsVersion: errands.settingsVersion,
        agentTier: errands.agentTier,
      })
      .from(errands)
      .where(eq(errands.id, errandId));
    if (!row) return null;
    const [settings, { currency }, tier] = await Promise.all([
      this.countries.settingsAt(row.countryCode, row.settingsVersion),
      this.countries.basics(row.countryCode),
      acceptingAgentId ? this.agents.tier(acceptingAgentId) : Promise.resolve<AgentTier>(row.agentTier ?? 'bronze'),
    ]);
    return { settings, currency, tier };
  }

  private async viewOne(errand: ErrandRow, role: ViewerRole) {
    const [view] = await this.views([errand], () => role);
    return view!;
  }

  /** Runs one event from the customer or agent app through the state machine. */
  async transition(errandId: string, auth: AuthContext, input: ErrandEventInput) {
    try {
      return await this.runTransition(errandId, auth, input);
    } catch (error) {
      // An agent tried to accept but the customer's wallet no longer covers it: tell the customer.
      if (error instanceof CustomerFundsLow) await this.notifier.customerFundsLow(errandId);
      throw error;
    }
  }

  private async runTransition(errandId: string, auth: AuthContext, input: ErrandEventInput) {
    const money = await this.settingsOf(
      errandId,
      input.event === 'accept' && auth.app === 'agent' ? auth.userId : undefined,
    );
    if (!money) throw notFound('errand_not_found', 'Errand not found');
    const { settings } = money;

    const outcome = await this.db.transaction(async (tx) => {
      const [errand] = await tx.select().from(errands).where(eq(errands.id, errandId)).for('update');
      const role = errand ? this.roleFor(errand, auth) : null;
      if (!errand || !role) throw notFound('errand_not_found', 'Errand not found');
      if (role === 'prospect' && input.event !== 'accept') throw notFound('errand_not_found', 'Errand not found');
      if (input.version !== undefined && input.version !== errand.version) {
        throw conflict('errand_changed', 'This errand changed. Refresh and try again.', { version: errand.version });
      }

      const actor = role === 'customer' ? 'customer' : 'agent';
      const to = nextState(errand.status, input.event, transitionContext(errand, actor));
      const event = input.event as ErrandEvent;
      const effect = await this.effectOf(tx, event, errand, auth, input.data, settings, money.tier);
      if (effect instanceof ApiError) return { error: effect };

      const after = await this.write(tx, errand, event, to, effect, actor, auth.userId);
      await this.wallet.onErrandTransition(tx, { before: errand, after, event, ...money });
      await this.scheduleTimers(after, settings);
      return {
        role: role === 'prospect' ? ('agent' as const) : role,
        result: { before: errand, after, event, record: effect.record, settings } satisfies TransitionResult,
      };
    });

    if ('error' in outcome) throw outcome.error;
    await this.notifier.transitioned(outcome.result);
    return this.viewOne(outcome.result.after, outcome.role);
  }

  /** A timer came due. It applies only if the errand has not moved since the timer was set. */
  async applyTimer(job: ErrandTimerJob) {
    const money = await this.settingsOf(job.errandId);
    if (!money) return;
    const { settings } = money;
    const result = await this.db.transaction(async (tx) => {
      const [errand] = await tx.select().from(errands).where(eq(errands.id, job.errandId)).for('update');
      if (!errand || errand.version !== job.version || errand.status !== job.status) return null;
      const to = nextState(errand.status, job.event, transitionContext(errand, 'system'));
      const effect: EventEffect = { patch: {}, record: { timer: true } };
      const after = await this.write(tx, errand, job.event, to, effect, 'system', null);
      await this.wallet.onErrandTransition(tx, { before: errand, after, event: job.event as ErrandEvent, ...money });
      await this.scheduleTimers(after, settings);
      return {
        before: errand,
        after,
        event: job.event as ErrandEvent,
        record: effect.record,
        settings,
      } satisfies TransitionResult;
    });
    if (result) await this.notifier.transitioned(result);
  }

  private async write(
    tx: Tx,
    errand: ErrandRow,
    event: string,
    to: ErrandState,
    effect: EventEffect,
    actorRole: 'customer' | 'agent' | 'system' | 'admin',
    actorId: string | null,
  ) {
    const now = new Date();
    const [after] = await tx
      .update(errands)
      .set({
        ...effect.patch,
        status: to,
        version: errand.version + 1,
        updatedAt: now,
        ...(to === 'completed' ? { completedAt: now } : {}),
        ...(to === 'cancelled' ? { cancelledAt: now } : {}),
      })
      .where(and(eq(errands.id, errand.id), eq(errands.version, errand.version)))
      .returning();
    if (!after) throw conflict('errand_changed', 'This errand changed. Refresh and try again.');
    await tx.insert(errandEvents).values({
      errandId: errand.id,
      event,
      fromStatus: errand.status,
      toStatus: to,
      actorRole,
      actorId,
      data: effect.record,
    });
    return after;
  }

  private parse<E extends keyof typeof EVENT_DATA>(event: E, data: Record<string, unknown>) {
    const parsed = EVENT_DATA[event].safeParse(data);
    if (!parsed.success) {
      throw badRequest('invalid_request', 'The request is not valid', {
        issues: parsed.error.issues.map((i) => ({ path: ['data', ...i.path].join('.'), message: i.message })),
      });
    }
    return parsed.data as z.infer<(typeof EVENT_DATA)[E]>;
  }

  /**
   * The checks and field changes for one event. Returns an ApiError (instead of throwing) when the
   * refusal must still be saved, such as a wrong PIN counting towards the limit.
   */
  private async effectOf(
    tx: Tx,
    event: ErrandEvent,
    errand: ErrandRow,
    auth: AuthContext,
    data: Record<string, unknown>,
    settings: CountrySettings,
    tier: AgentTier,
  ): Promise<EventEffect | ApiError> {
    const now = new Date();
    const releaseAgent: Patch = {
      agentId: null,
      agentTier: null,
      pinCipher: null,
      pinAttempts: 0,
      pendingOfferKobo: null,
      acceptedAt: null,
    };

    switch (event) {
      case 'accept': {
        const [agent] = await tx.select({ firstName: users.firstName }).from(users).where(eq(users.id, auth.userId));
        if (!agent?.firstName) throw conflict('profile_incomplete', 'Add your name before accepting errands');
        const pin = numericCode(4);
        return {
          patch: {
            agentId: auth.userId,
            agentTier: tier,
            acceptedAt: now,
            pinCipher: encrypt(this.config.PIN_KEY, pin),
            pinAttempts: 0,
          },
          record: { agentId: auth.userId },
        };
      }
      case 'withdraw':
      case 'release_agent':
        return { patch: releaseAgent, record: { agentId: errand.agentId } };
      case 'cancel':
        return { patch: { pendingOfferKobo: null }, record: this.parse('cancel', data) };
      case 'send_offer': {
        const { amountKobo } = this.parse('send_offer', data);
        if (amountKobo === errand.feeKobo)
          throw unprocessable('offer_unchanged', 'The new price is the same as the current fee');
        if (amountKobo < settings.pricing.minFeeKobo) {
          throw unprocessable('fee_too_low', 'The fee is below the minimum', {
            minFeeKobo: settings.pricing.minFeeKobo,
          });
        }
        return { patch: { pendingOfferKobo: amountKobo }, record: { amountKobo, previousFeeKobo: errand.feeKobo } };
      }
      case 'accept_offer':
        return {
          patch: {
            feeKobo: errand.pendingOfferKobo!,
            serviceFeeKobo: serviceFee(errand.pendingOfferKobo!, settings.fees),
            pendingOfferKobo: null,
          },
          record: { amountKobo: errand.pendingOfferKobo, previousFeeKobo: errand.feeKobo },
        };
      case 'decline_offer':
        return { patch: { pendingOfferKobo: null }, record: { amountKobo: errand.pendingOfferKobo } };
      case 'start':
        return { patch: { startedAt: now }, record: {} };
      case 'send_item_amount': {
        const { amountKobo, photos } = this.parse('send_item_amount', data);
        return { patch: { itemAmountKobo: amountKobo }, record: { amountKobo, photos } };
      }
      case 'mark_delivered':
        return { patch: { deliveredAt: now }, record: {} };
      case 'confirm_pin': {
        const { pin } = this.parse('confirm_pin', data);
        const limit = settings.limits.pinAttempts;
        if (errand.pinAttempts >= limit) {
          throw locked('pin_locked', 'Too many wrong PINs. Send a drop-off photo instead, or contact support.');
        }
        const actual = errand.pinCipher ? decrypt(this.config.PIN_KEY, errand.pinCipher) : null;
        if (!actual || !safeEqual(actual, pin)) {
          const attempts = errand.pinAttempts + 1;
          await tx.update(errands).set({ pinAttempts: attempts }).where(eq(errands.id, errand.id));
          return unprocessable('wrong_pin', 'That PIN is not right', { attemptsLeft: Math.max(0, limit - attempts) });
        }
        return { patch: {}, record: { method: 'pin' } };
      }
      case 'send_dropoff_photo':
        return { patch: {}, record: this.parse('send_dropoff_photo', data) };
      case 'report_unreachable':
        return { patch: {}, record: this.parse('report_unreachable', data) };
      case 'open_dispute':
        return { patch: { pendingOfferKobo: null }, record: { ...this.parse('open_dispute', data), by: auth.app } };
      default:
        return { patch: {}, record: {} };
    }
  }

  /**
   * Sets the system timer for the state the errand just entered, if that state has one. Called inside
   * the transaction: if the timer cannot be stored the change is rolled back, so an errand is never left
   * in a state whose timer is missing. A timer whose transaction later fails finds a different version
   * when it fires and does nothing.
   */
  private async scheduleTimers(errand: ErrandRow, settings: CountrySettings) {
    const t = settings.timers;
    const plan: Partial<Record<ErrandState, [ErrandTimerJob['event'], number]>> = {
      item_pending: ['item_lock_timeout', t.itemLockMinutes * MINUTE_MS],
      photo_pending: ['auto_release', t.autoReleaseHours * HOUR_MS],
      unreachable: ['unreachable_timeout', t.unreachableHours * HOUR_MS],
      ...(errand.urgent
        ? { requested: ['expire', t.urgentExpiryMinutes * MINUTE_MS] as [ErrandTimerJob['event'], number] }
        : {}),
    };
    const due = plan[errand.status];
    if (!due) return;
    await this.timers.schedule(
      { errandId: errand.id, event: due[0], status: errand.status, version: errand.version },
      due[1],
    );
  }
}
