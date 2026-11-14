import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { and, desc, eq, gt, inArray, isNull, lt, ne, sql } from 'drizzle-orm';
import {
  AGENT_OUT_STATES,
  canRevealPin,
  commissionBpsFor,
  splitFeeEscrow,
  nextState,
  serviceFee,
  suggestedFee,
  TERMINAL_STATES,
  type AgentTier,
  type CountrySettings,
  type ErrandEvent,
  type ErrandState,
} from '@jiffo/shared';
import type { z } from 'zod';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { DB, type Db, type Tx } from '../db/database.module';
import { earningHolds, errandEvents, errandRatings, errandStops, errands, journalEntries, users } from '../db/schema';
import { CountriesService } from '../countries/countries.service';
import type { AuthContext } from '../auth/auth.types';
import { decrypt, encrypt, errandPinKey, numericCode, pinDigest, safeEqual } from '../common/crypto';
import { ApiError, badRequest, conflict, forbidden, locked, notFound, tooMany, unprocessable } from '../common/errors';
import { refuseUnknownFields } from '../common/zod-body';
import { ERRAND_TIMERS, type ErrandTimerJob, type ErrandTimers } from '../timers/errand-timers';
import { CustomerFundsLow, WalletService, type DisputeSplit } from '../money/wallet.service';
import { AgentsService } from '../agents/agents.service';
import { PresenceService, SHARE_STATES, TRAVEL_STATES } from '../agents/presence.service';
import { AgentApplicationService } from '../agents/application.service';
import { CustomerIdentityService } from '../identity/customer-identity.service';
import { MAPS, type MapsAdapter } from '../adapters/maps';
import { UploadsService } from '../files/uploads.service';
import { participantRole } from './access';
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

/** The last wrong hand-off PIN: the errand is frozen for support instead of the entry being refused. */
class PinLock {
  constructor(readonly attempts: number) {}
}

/** A position older than this doesn't show the agent is at the drop-off, or where they look at the board from. */
const LOCATION_FRESH_MS = 5 * 60_000;
/** How far from the agent's own position the board may be asked about. */
const BOARD_NEAR_KM = 5;
/** A customer with fewer finished errands than this is new, and the new-customer item limit applies. */
const NEW_CUSTOMER_ERRANDS = 3;

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

export interface Settlement {
  agentKobo: number;
  commissionKobo: number;
  itemsKobo: number;
  tipKobo: number;
  tier: string | null;
  /** Settled by support, which may have shared the fee differently from a hand-off. */
  bySupport: boolean;
  /** Bronze earnings wait before they can be withdrawn; null once available. */
  heldUntil: Date | null;
}

/** The events support sends from the admin panel. */
export const ADMIN_ERRAND_EVENTS = [
  'admin_cancel',
  'admin_intervene',
  'redeliver',
  'resolve_complete',
  'resolve_cancel',
] as const;
export type AdminErrandEvent = (typeof ADMIN_ERRAND_EVENTS)[number];

/** How far from the pickup the matching screen counts online agents. */
const NEARBY_RADIUS_KM = 3;

/** How an errand reached completed, for the customer's receipt. */
type CompletedBy = 'pin' | 'photo' | 'auto' | 'support';
const COMPLETED_BY: Partial<Record<string, CompletedBy>> = {
  confirm_pin: 'pin',
  approve_photo: 'photo',
  auto_release: 'auto',
  resolve_complete: 'support',
};

/** Events checked outside the errand's transaction first, and who may send them. */
const PRECHECKED: Partial<Record<string, 'customer' | 'agent'>> = {
  send_item_amount: 'agent',
  send_dropoff_photo: 'agent',
  raise_fee: 'customer',
};

@Injectable()
export class ErrandsService implements OnModuleInit {
  private readonly logger = new Logger('Errands');

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(ERRAND_TIMERS) private readonly timers: ErrandTimers,
    private readonly countries: CountriesService,
    private readonly notifier: ErrandNotifier,
    private readonly wallet: WalletService,
    private readonly agents: AgentsService,
    @Inject(MAPS) private readonly maps: MapsAdapter,
    private readonly uploads: UploadsService,
    private readonly presence: PresenceService,
    private readonly applications: AgentApplicationService,
    private readonly customerIdentity: CustomerIdentityService,
  ) {}

  onModuleInit() {
    this.timers.setHandler((job) => this.applyTimer(job));
  }

  /* ---------- Reading ---------- */

  private roleFor(errand: ErrandRow, auth: AuthContext): ViewerRole | null {
    const participant = participantRole(errand, auth);
    if (participant || auth.app === 'customer') return participant;
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
    const withItems = rows.filter((r) => r.itemAmountKobo !== null).map((r) => r.id);
    const [stops, people, locks] = await Promise.all([
      this.db.select().from(errandStops).where(inArray(errandStops.errandId, ids)),
      this.people(rows),
      withItems.length
        ? this.db
            .select({ errandId: errandEvents.errandId })
            .from(errandEvents)
            .where(and(inArray(errandEvents.errandId, withItems), eq(errandEvents.event, 'lock_item_amount')))
        : Promise.resolve([]),
    ]);
    const locked = new Set(locks.map((l) => l.errandId));
    const stopsBy = new Map<string, StopRow[]>();
    for (const s of stops) stopsBy.set(s.errandId, [...(stopsBy.get(s.errandId) ?? []), s]);
    return rows.map((r) =>
      errandView(
        r,
        stopsBy.get(r.id) ?? [],
        { customer: people.get(r.customerId) ?? null, agent: r.agentId ? (people.get(r.agentId) ?? null) : null },
        roleOf(r),
        locked.has(r.id),
      ),
    );
  }

  private async load(errandId: string, auth: AuthContext) {
    const [errand] = await this.db.select().from(errands).where(eq(errands.id, errandId));
    const role = errand ? this.roleFor(errand, auth) : null;
    if (!errand || !role) throw notFound('errand_not_found', 'Errand not found');
    // A waiting errand is shown only to agents who may take it: an account that signed in with a code alone isn't one.
    if (role === 'prospect' && !(await this.applications.approved(auth.userId))) {
      throw notFound('errand_not_found', 'Errand not found');
    }
    return { errand, role };
  }

  async get(errandId: string, auth: AuthContext) {
    const { errand, role } = await this.load(errandId, auth);
    return this.viewOne(errand, role, auth.userId);
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
    const views = await this.views(rows, () => (auth.app === 'customer' ? 'customer' : 'agent'));
    if (auth.app === 'customer') return views;
    // Agents see what each finished job earned them: their fee share plus any tip.
    const paid = await this.wallet.settlements(rows.filter((r) => r.status === 'completed').map((r) => r.id));
    return views.map((v) => {
      const p = paid.get(v.id);
      return { ...v, earnedKobo: p ? p.agentKobo + p.tipKobo : null };
    });
  }

  /** Open errands whose pickup is within the radius, nearest first. */
  async board(auth: AuthContext, q: { lat: number; lng: number; radiusKm: number; limit: number }) {
    await this.applications.assertApproved(auth.userId);
    // Only around where the agent's phone last said they are, so the board can't be asked about any place:
    // the search is centred there, and the place the app asks about must be close to it.
    const { rows: positions } = await this.db.execute<{
      at: Date | string | null;
      lat: number | null;
      lng: number | null;
      km: number | string | null;
    }>(sql`
      select located_at as at, lat, lng,
        ST_Distance(location, ST_SetSRID(ST_MakePoint(${q.lng}, ${q.lat}), 4326)::geography) / 1000 as km
      from agent_presence where user_id = ${auth.userId} and location is not null`);
    const at = positions[0];
    if (!at?.at || at.lat === null || at.lng === null || Date.now() - new Date(at.at).getTime() > LOCATION_FRESH_MS) {
      throw conflict('location_needed', 'Turn on location to see errands near you');
    }
    if (Number(at.km) > BOARD_NEAR_KM) {
      throw unprocessable('not_here', 'The board shows errands near where you are');
    }
    // Only errands in the agent's chosen categories, and purchase errands only if they take them.
    const [prefs, tier] = await Promise.all([this.agents.profile(auth.userId), this.agents.tier(auth.userId)]);
    const here = sql`ST_SetSRID(ST_MakePoint(${at.lng}, ${at.lat}), 4326)::geography`;
    const distance = sql<number>`ST_Distance(${errandStops.location}, ${here})`;
    const open = and(
      eq(errands.status, 'requested'),
      eq(errands.countryCode, auth.countryCode),
      ne(errands.customerId, auth.userId),
      sql`ST_DWithin(${errandStops.location}, ${here}, ${q.radiusKm * 1000})`,
    );
    const filtered = !!prefs.categoryKeys || !prefs.takesPurchases;
    const wanted = and(
      open,
      prefs.categoryKeys ? inArray(errands.categoryKey, prefs.categoryKeys) : undefined,
      prefs.takesPurchases ? undefined : eq(errands.buy, false),
    );
    const pickupOf = and(eq(errandStops.errandId, errands.id), eq(errandStops.seq, 0));
    const [rows, counts] = await Promise.all([
      this.db
        .select({ errand: errands, distanceMeters: distance })
        .from(errands)
        .innerJoin(errandStops, pickupOf)
        .where(wanted)
        .orderBy(distance)
        .limit(q.limit),
      // How many nearby errands the agent's preferences leave out, so the board can say so.
      filtered
        ? this.db
            .select({
              all: sql<number>`count(*)::int`,
              wanted: sql<number>`count(*) filter (where ${wanted})::int`,
            })
            .from(errands)
            .innerJoin(errandStops, pickupOf)
            .where(open)
        : Promise.resolve([{ all: 0, wanted: 0 }]),
    ]);
    const views = await this.views(
      rows.map((r) => r.errand),
      () => 'prospect',
    );
    const earns = await Promise.all(rows.map((r) => this.agentEarns(r.errand, tier)));
    return {
      errands: views.map((v, i) => ({
        ...v,
        distanceMeters: Math.round(Number(rows[i]!.distanceMeters)),
        agentEarnsKobo: earns[i]!,
      })),
      hiddenByPreferences: Math.max(0, (counts[0]?.all ?? 0) - (counts[0]?.wanted ?? 0)),
    };
  }

  async events(errandId: string, auth: AuthContext) {
    const { role } = await this.load(errandId, auth);
    if (role === 'prospect') throw notFound('errand_not_found', 'Errand not found');
    const rows = await this.db
      .select()
      .from(errandEvents)
      .where(eq(errandEvents.errandId, errandId))
      .orderBy(errandEvents.id);
    return rows.map((e) => {
      // Who took or left the errand is support's to know: a customer or a later agent never gets another
      // agent's ID from it (docs/security-plan.md, R4).
      const { agentId: _agent, ...data } = (e.data ?? {}) as Record<string, unknown>;
      return {
        id: e.id,
        event: e.event,
        fromStatus: e.fromStatus,
        toStatus: e.toStatus,
        actorRole: e.actorRole,
        // Support's notes and splits are internal; the apps only learn that support acted.
        data: e.actorRole === 'admin' ? { by: 'support' } : data,
        createdAt: e.createdAt,
      };
    });
  }

  /** The customer's hand-off PIN. Shown only once the agent has marked the errand delivered. */
  async pin(errandId: string, auth: AuthContext) {
    const { errand, role } = await this.load(errandId, auth);
    if (role !== 'customer') throw notFound('errand_not_found', 'Errand not found');
    if (!canRevealPin(errand.status) || !errand.pinCipher) {
      throw conflict('pin_not_available', 'Your PIN shows once the agent marks the errand delivered');
    }
    return { pin: this.openPin(errand.id, errand.pinCipher) };
  }

  /** The PIN from its cipher: under the errand's own key ("v2:"), or the master key for older errands. */
  private openPin(errandId: string, cipher: string) {
    return cipher.startsWith('v2:')
      ? decrypt(errandPinKey(this.config.PIN_KEY, errandId), cipher.slice(3))
      : decrypt(this.config.PIN_KEY, cipher);
  }

  /** The entered PIN against the errand's: by its keyed hash, or by decrypting it for older errands. */
  private pinMatches(errand: ErrandRow, pin: string) {
    if (errand.pinHmac) return safeEqual(pinDigest(errandPinKey(this.config.PIN_KEY, errand.id), pin), errand.pinHmac);
    return !!errand.pinCipher && safeEqual(this.openPin(errand.id, errand.pinCipher), pin);
  }

  /**
   * The most item money this errand may hold: a new (Bronze) agent's limit, and a new customer's (fewer
   * than NEW_CUSTOMER_ERRANDS finished errands), whichever is lower. Null when neither applies.
   */
  private async itemLimit(tx: Tx, errand: ErrandRow, settings: CountrySettings) {
    const limits: number[] = [];
    if ((errand.agentTier ?? 'bronze') === 'bronze') limits.push(settings.limits.newAgentItemLimitKobo);
    const [done] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(errands)
      .where(and(eq(errands.customerId, errand.customerId), eq(errands.status, 'completed')));
    if ((done?.n ?? 0) < NEW_CUSTOMER_ERRANDS) limits.push(settings.limits.newCustomerItemLimitKobo);
    return limits.length ? Math.min(...limits) : null;
  }

  /** Whether the agent's latest position is fresh and within the set distance of the drop-off. */
  private async assertAtDropoff(tx: Tx, errand: ErrandRow, settings: CountrySettings) {
    const meters = settings.security.handoffDistanceMeters;
    if (!meters) return;
    const { rows } = await tx.execute<{ locatedAt: Date | string | null; distance: number | string | null }>(sql`
      select p.located_at as "locatedAt", ST_Distance(p.location, s.location) as distance
      from agent_presence p, errand_stops s
      where p.user_id = ${errand.agentId} and s.errand_id = ${errand.id} and s.kind = 'dropoff'
        and p.location is not null
      order by s.seq desc limit 1`);
    const at = rows[0];
    const fresh = at?.locatedAt && Date.now() - new Date(at.locatedAt).getTime() < LOCATION_FRESH_MS;
    if (!at || !fresh) {
      throw unprocessable('location_needed', 'Turn on location: Jiffo checks you are at the drop-off');
    }
    const distance = Number(at.distance);
    if (distance > meters) {
      throw unprocessable('not_at_dropoff', 'Go to the drop-off first', { distanceMeters: Math.round(distance) });
    }
  }

  /* ---------- Creating ---------- */

  /** Distance, time and the suggested fee for a route, under the country's current pricing. */
  async quote(auth: AuthContext, stops: Array<{ lat: number; lng: number }>) {
    const [{ settings }, route] = await Promise.all([
      this.countries.currentSettings(auth.countryCode),
      this.maps.route(stops),
    ]);
    const suggestedFeeKobo = suggestedFee(settings.pricing, route.distanceMeters);
    return {
      ...route,
      suggestedFeeKobo,
      minFeeKobo: settings.pricing.minFeeKobo,
      serviceFeeKobo: serviceFee(suggestedFeeKobo, settings.fees),
    };
  }

  async create(auth: AuthContext, input: CreateErrandInput) {
    const [customer] = await this.db.select().from(users).where(eq(users.id, auth.userId));
    if (!customer?.firstName) throw conflict('profile_incomplete', 'Add your name before sending an errand');
    // Every customer is verified, so agents know who they run errands for.
    await this.customerIdentity.assertVerified(auth.userId);
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
    await this.assertWalletCovers(customer.id, country, input.feeKobo, settings, 'send this errand');

    const created = await this.db.transaction(async (tx) => {
      // Shares the lock a suspension takes, so an errand can't slip in while the account is being suspended.
      const [still] = await tx
        .select({ status: users.status })
        .from(users)
        .where(eq(users.id, auth.userId))
        .for('share');
      if (still?.status !== 'active')
        throw forbidden('account_suspended', 'This account is suspended. Contact support.');
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

    return this.viewOne(created, 'customer', auth.userId);
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

  /**
   * One errand in full: the list view, plus for its customer and agent the receipt, item and drop-off
   * photos (short-lived links) and whether they have rated it.
   */
  private async viewOne(errand: ErrandRow, role: ViewerRole, viewerId?: string) {
    const [view] = await this.views([errand], () => role);
    const empty = {
      photos: { items: [] as string[], dropoff: null as string | null },
      ratedByMe: false,
      tipped: false,
      held: { feeKobo: 0, itemsKobo: 0 },
      pendingOfferServiceFeeKobo: null as number | null,
      completedBy: null as CompletedBy | null,
      agentEarnsKobo: null as number | null,
      settlement: null as Settlement | null,
      agentLocation: null as { lat: number; lng: number; at: Date } | null,
      nearbyAgents: null as { count: number; radiusKm: number } | null,
    };
    if (!viewerId) return { ...view!, ...empty };
    // An agent deciding whether to accept sees what they would earn at their tier.
    if (role === 'prospect') {
      return { ...view!, ...empty, agentEarnsKobo: await this.agentEarns(errand, await this.agents.tier(viewerId)) };
    }
    // Only look for what can exist: photos once the agent has started, ratings and tips once completed.
    const mayHavePhotos =
      !['requested', 'accepted', 'started'].includes(errand.status) || errand.itemAmountKobo !== null;
    const completed = errand.status === 'completed';
    // Money sits in escrow only between accept and the end of the errand.
    const mayHoldMoney = errand.status !== 'requested' && !TERMINAL_STATES.has(errand.status);
    const offer = errand.pendingOfferKobo;
    const pickup = view!.stops[0]!;
    // The customer sees the agent's position while the agent is on the way for them (sharedWith).
    const travelling = SHARE_STATES.includes(errand.status);
    const [photoEvents, [rating], [tip], held, offerSettings, [ending], agentLocation, nearby, earns, settled] =
      await Promise.all([
        mayHavePhotos
          ? this.db
              .select({ event: errandEvents.event, data: errandEvents.data })
              .from(errandEvents)
              .where(
                and(
                  eq(errandEvents.errandId, errand.id),
                  inArray(errandEvents.event, ['send_item_amount', 'send_dropoff_photo']),
                ),
              )
              .orderBy(desc(errandEvents.id))
          : Promise.resolve([]),
        completed
          ? this.db
              .select({ id: errandRatings.id })
              .from(errandRatings)
              .where(and(eq(errandRatings.errandId, errand.id), eq(errandRatings.raterId, viewerId)))
          : Promise.resolve([]),
        completed && role === 'customer'
          ? this.db
              .select({ id: journalEntries.id })
              .from(journalEntries)
              .where(eq(journalEntries.key, `errand:${errand.id}:tip`))
          : Promise.resolve([]),
        mayHoldMoney ? this.wallet.heldFor(errand.id, errand.countryCode) : Promise.resolve(empty.held),
        // A new price's service fee follows the settings the errand was created under, as accepting it will.
        offer !== null ? this.countries.settingsAt(errand.countryCode, errand.settingsVersion) : Promise.resolve(null),
        completed
          ? this.db
              .select({ event: errandEvents.event })
              .from(errandEvents)
              .where(and(eq(errandEvents.errandId, errand.id), eq(errandEvents.toStatus, 'completed')))
              .orderBy(desc(errandEvents.id))
              .limit(1)
          : Promise.resolve([]),
        // The customer follows their agent on the map while the errand runs.
        role === 'customer' && travelling && errand.agentId
          ? this.presence.locationFor(errand.id, errand.agentId)
          : Promise.resolve(null),
        // While matching, the customer sees how many agents are online near the pickup, never who or where.
        role === 'customer' && errand.status === 'requested'
          ? this.presence.onlineNear(
              errand.countryCode,
              pickup.lat,
              pickup.lng,
              NEARBY_RADIUS_KM * 1000,
              errand.customerId,
            )
          : Promise.resolve(null),
        role === 'agent' ? this.agentEarns(errand, errand.agentTier ?? 'bronze') : Promise.resolve(null),
        // Support can pay the agent on an errand it settles as cancelled, too.
        (completed || errand.status === 'cancelled') && role === 'agent'
          ? this.settlementOf(errand)
          : Promise.resolve(null),
      ]);
    const items = (photoEvents.find((e) => e.event === 'send_item_amount')?.data.photos as string[] | undefined) ?? [];
    const dropoff = photoEvents.find((e) => e.event === 'send_dropoff_photo')?.data.photo as string | undefined;
    return {
      ...view!,
      photos: {
        items: await Promise.all(items.map((k) => this.uploads.url(k))),
        dropoff: dropoff ? await this.uploads.url(dropoff) : null,
      },
      ratedByMe: !!rating,
      tipped: !!tip,
      held,
      pendingOfferServiceFeeKobo: offer !== null && offerSettings ? serviceFee(offer, offerSettings.fees) : null,
      completedBy: ending ? (COMPLETED_BY[ending.event] ?? null) : null,
      agentEarnsKobo: earns,
      settlement: settled,
      agentLocation,
      nearbyAgents: nearby === null ? null : { count: nearby, radiusKm: NEARBY_RADIUS_KM },
    };
  }

  /**
   * Once an agent is off an errand, their location is kept only if they are still online or busy.
   * Best effort: the change is already saved, so a failure here is logged, not returned. The scheduled
   * sweep deletes any position left behind.
   */
  private async afterAgentLeft(before: ErrandRow, after: ErrandRow) {
    const travelling = (status: string) => (TRAVEL_STATES as readonly string[]).includes(status);
    if (!before.agentId || !travelling(before.status) || travelling(after.status)) return;
    try {
      await this.presence.forgetIfIdle(before.agentId);
    } catch (error) {
      this.logger.warn(`Could not clear agent ${before.agentId}'s position: ${String(error)}`);
    }
  }

  /** How a finished errand paid its agent, and when its held fee share becomes withdrawable. */
  private async settlementOf(errand: ErrandRow): Promise<Settlement | null> {
    const [paid, holds] = await Promise.all([
      this.wallet.settlements([errand.id]),
      this.db
        .select({ amountKobo: earningHolds.amountKobo, availableAt: earningHolds.availableAt })
        .from(earningHolds)
        .where(
          and(
            eq(earningHolds.errandId, errand.id),
            eq(earningHolds.userId, errand.agentId!),
            isNull(earningHolds.releasedAt),
            // A hold that is due already counts as available, as the wallet shows it.
            gt(earningHolds.availableAt, new Date()),
          ),
        ),
    ]);
    const p = paid.get(errand.id);
    if (!p) return null;
    // The fee share's own hold, not a later tip's.
    const feeHold = holds.find((h) => h.amountKobo === p.agentKobo);
    return { ...p, heldUntil: feeHold?.availableAt ?? null };
  }

  /** What the agent keeps from the fee after commission at their tier, under the errand's own settings. */
  private async agentEarns(errand: ErrandRow, tier: AgentTier) {
    const settings = await this.countries.settingsAt(errand.countryCode, errand.settingsVersion);
    return splitFeeEscrow({
      feeKobo: errand.feeKobo,
      serviceFeeKobo: errand.serviceFeeKobo,
      commissionBps: commissionBpsFor(settings.fees, tier),
    }).agentKobo;
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
    // An event's data holds only the fields that event takes, and an event that takes none holds none.
    if (Object.prototype.hasOwnProperty.call(EVENT_DATA, input.event)) {
      refuseUnknownFields(EVENT_DATA[input.event as keyof typeof EVENT_DATA], input.data, ['data']);
    } else if (Object.keys(input.data).length) {
      throw badRequest('invalid_request', 'The request is not valid', {
        issues: Object.keys(input.data).map((k) => ({ path: `data.${k}`, message: 'Not a field this request takes' })),
      });
    }
    if (input.event === 'accept' && auth.app === 'agent') await this.applications.assertApproved(auth.userId);
    const money = await this.settingsOf(
      errandId,
      input.event === 'accept' && auth.app === 'agent' ? auth.userId : undefined,
    );
    if (!money) throw notFound('errand_not_found', 'Errand not found');
    const { settings } = money;
    // Some events need checks outside the errand's transaction: photos (the file store) and a raised fee
    // (the wallet). First make sure the caller may do this at all and is looking at the current errand,
    // so a stranger, a wrong state or a stale screen gets the right answer before any of that.
    const precheckActor = PRECHECKED[input.event];
    if (precheckActor) {
      const [current] = await this.db.select().from(errands).where(eq(errands.id, errandId));
      if (!current || this.roleFor(current, auth) !== precheckActor) {
        throw notFound('errand_not_found', 'Errand not found');
      }
      if (input.version !== undefined && input.version !== current.version) {
        throw conflict('errand_changed', 'This errand changed. Refresh and try again.', { version: current.version });
      }
      nextState(current.status, input.event, transitionContext(current, precheckActor));
      if (input.event === 'raise_fee') {
        const { amountKobo } = this.parse('raise_fee', input.data);
        await this.assertWalletCovers(current.customerId, current.countryCode, amountKobo, settings, 'raise the fee');
      }
    }
    if (input.event === 'send_item_amount') {
      const { photos } = this.parse('send_item_amount', input.data);
      await this.uploads.assertUploaded(photos, {
        ownerId: auth.userId,
        errandId,
        purposes: ['receipt', 'item_photo'],
      });
    }
    if (input.event === 'send_dropoff_photo') {
      const { photo } = this.parse('send_dropoff_photo', input.data);
      await this.uploads.assertUploaded([photo], { ownerId: auth.userId, errandId, purposes: ['dropoff_photo'] });
    }

    const { settings: live } = await this.countries.currentSettings(auth.countryCode);
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
      const effect = await this.effectOf(tx, event, errand, auth, input.data, settings, money.tier, live);
      if (effect instanceof PinLock) {
        // Frozen for support: both escrows stay held until support decides.
        const record = { attempts: effect.attempts };
        const frozen = await this.write(
          tx,
          errand,
          'pin_locked',
          nextState(errand.status, 'pin_locked', transitionContext(errand, 'system')),
          { patch: { pinAttempts: effect.attempts }, record },
          'system',
          null,
        );
        await this.wallet.onErrandTransition(tx, { before: errand, after: frozen, event: 'pin_locked', ...money });
        await this.scheduleTimers(frozen, settings);
        return {
          error: locked('pin_locked', 'Too many wrong PINs. Jiffo support will look at this errand and sort it out.'),
          frozen: {
            before: errand,
            after: frozen,
            event: 'pin_locked',
            record,
            settings,
          } satisfies TransitionResult,
        };
      }
      if (effect instanceof ApiError) return { error: effect };

      const after = await this.write(tx, errand, event, to, effect, actor, auth.userId);
      await this.wallet.onErrandTransition(tx, { before: errand, after, event, ...money });
      await this.scheduleTimers(after, settings);
      return {
        role: role === 'prospect' ? ('agent' as const) : role,
        result: { before: errand, after, event, record: effect.record, settings } satisfies TransitionResult,
      };
    });

    if ('error' in outcome) {
      if ('frozen' in outcome && outcome.frozen) await this.notifier.transitioned(outcome.frozen);
      throw outcome.error;
    }
    await this.notifier.transitioned(outcome.result);
    await this.afterAgentLeft(outcome.result.before, outcome.result.after);
    return this.viewOne(outcome.result.after, outcome.role, auth.userId);
  }

  /** The wallet must hold the fee and its service fee before an errand goes out or its fee goes up. */
  private async assertWalletCovers(
    customerId: string,
    countryCode: string,
    feeKobo: number,
    settings: CountrySettings,
    action: string,
  ) {
    const neededKobo = feeKobo + serviceFee(feeKobo, settings.fees);
    const balanceKobo = await this.wallet.customerBalance(customerId, countryCode);
    if (balanceKobo < neededKobo) {
      throw conflict('insufficient_funds', `Top up your wallet to ${action}`, { neededKobo, balanceKobo });
    }
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
    if (result) {
      await this.notifier.transitioned(result);
      await this.afterAgentLeft(result.before, result.after);
    }
  }

  /**
   * Support's own events: stepping into an errand, arranging a redelivery, and settling a dispute, either
   * the standard way (completed pays the agent as at a hand-off; cancelled returns everything) or with a
   * split. The caller's audit record is written in the same transaction as the change.
   */
  async adminTransition(
    errandId: string,
    adminId: string,
    input: { event: AdminErrandEvent; version: number; note: string; split?: DisputeSplit },
    audit: (tx: Tx, before: ErrandRow, after: ErrandRow) => Promise<unknown>,
  ) {
    const money = await this.settingsOf(errandId);
    if (!money) throw notFound('errand_not_found', 'Errand not found');
    const { settings } = money;
    if (input.split && input.event !== 'resolve_complete' && input.event !== 'resolve_cancel') {
      throw badRequest('split_not_allowed', 'Only settling a dispute shares out the money');
    }
    const result = await this.db.transaction(async (tx) => {
      const [errand] = await tx.select().from(errands).where(eq(errands.id, errandId)).for('update');
      if (!errand) throw notFound('errand_not_found', 'Errand not found');
      if (input.version !== errand.version) {
        throw conflict('errand_changed', 'This errand changed. Refresh and try again.', { version: errand.version });
      }
      const to = nextState(errand.status, input.event, transitionContext(errand, 'admin'));
      const effect: EventEffect = {
        patch: { pendingOfferKobo: null },
        record: { note: input.note, by: 'support', ...(input.split ? { split: input.split } : {}) },
      };
      const after = await this.write(tx, errand, input.event, to, effect, 'admin', adminId);
      if (input.split) await this.wallet.resolveDispute(tx, after, input.split, money);
      else await this.wallet.onErrandTransition(tx, { before: errand, after, event: input.event, ...money });
      await this.scheduleTimers(after, settings);
      await audit(tx, errand, after);
      return { before: errand, after, event: input.event as ErrandEvent, record: effect.record, settings };
    });
    await this.notifier.transitioned(result);
    await this.afterAgentLeft(result.before, result.after);
    return { id: result.after.id, status: result.after.status, version: result.after.version };
  }

  /**
   * Inside the caller's transaction, with the errand row already locked: support closes an errand still
   * waiting for an agent. Nothing is held yet, so no money moves. Call announce() after the commit.
   */
  async adminCancelWaiting(tx: Tx, errand: ErrandRow, adminId: string, note: string): Promise<TransitionResult> {
    const money = await this.settingsOf(errand.id);
    if (!money) throw notFound('errand_not_found', 'Errand not found');
    const to = nextState(errand.status, 'admin_cancel', transitionContext(errand, 'admin'));
    const effect: EventEffect = { patch: { pendingOfferKobo: null }, record: { note, by: 'support' } };
    const after = await this.write(tx, errand, 'admin_cancel', to, effect, 'admin', adminId);
    await this.wallet.onErrandTransition(tx, { before: errand, after, event: 'admin_cancel', ...money });
    return { before: errand, after, event: 'admin_cancel', record: effect.record, settings: money.settings };
  }

  /** After a caller's transaction commits: updates open screens and tells people about changes made in it. */
  async announce(results: TransitionResult[]) {
    for (const r of results) {
      await this.notifier.transitioned(r);
      await this.afterAgentLeft(r.before, r.after);
    }
  }

  /** One line on an errand's record. Only write() changes the errand itself. */
  private async logEvent(
    tx: Tx,
    errand: ErrandRow,
    event: string,
    to: ErrandState,
    actorRole: 'customer' | 'agent' | 'system' | 'admin',
    actorId: string | null,
    data: Record<string, unknown>,
  ) {
    await tx.insert(errandEvents).values({
      errandId: errand.id,
      event,
      fromStatus: errand.status,
      toStatus: to,
      actorRole,
      actorId,
      data,
    });
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
        // Once the errand is over, nobody needs its PIN again.
        ...(TERMINAL_STATES.has(to) ? { pinCipher: null, pinHmac: null } : {}),
      })
      .where(and(eq(errands.id, errand.id), eq(errands.version, errand.version)))
      .returning();
    if (!after) throw conflict('errand_changed', 'This errand changed. Refresh and try again.');
    await this.logEvent(tx, errand, event, to, actorRole, actorId, effect.record);
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
    /** The country's settings now: the security limits apply as admin sets them, also to errands already made. */
    live: CountrySettings,
  ): Promise<EventEffect | ApiError | PinLock> {
    const now = new Date();
    const releaseAgent: Patch = {
      agentId: null,
      agentTier: null,
      pinCipher: null,
      pinHmac: null,
      pinAttempts: 0,
      pendingOfferKobo: null,
      acceptedAt: null,
    };

    switch (event) {
      case 'accept': {
        // Shares the lock a suspension takes: an agent being suspended can't accept at the same moment.
        const [agent] = await tx
          .select({ firstName: users.firstName, status: users.status })
          .from(users)
          .where(eq(users.id, auth.userId))
          .for('share');
        if (agent?.status !== 'active')
          throw forbidden('account_suspended', 'This account is suspended. Contact support.');
        if (!agent.firstName) throw conflict('profile_incomplete', 'Add your name before accepting errands');
        const cap = live.security.maxActiveErrandsPerAgent;
        if (cap > 0) {
          // One accept at a time per agent, so the cap on errands held at once can't be raced.
          await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'agent-accept:' + auth.userId}))`);
          const [held] = await tx
            .select({ n: sql<number>`count(*)::int` })
            .from(errands)
            .where(and(eq(errands.agentId, auth.userId), inArray(errands.status, [...AGENT_OUT_STATES])));
          if ((held?.n ?? 0) >= cap)
            throw conflict('too_many_errands', 'Finish an errand you have before taking another');
        }
        const pin = numericCode(4);
        const key = errandPinKey(this.config.PIN_KEY, errand.id);
        return {
          patch: {
            agentId: auth.userId,
            agentTier: tier,
            acceptedAt: now,
            pinCipher: `v2:${encrypt(key, pin)}`,
            pinHmac: pinDigest(key, pin),
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
        const [recent] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(errandEvents)
          .where(
            and(
              eq(errandEvents.errandId, errand.id),
              eq(errandEvents.event, 'send_offer'),
              gt(errandEvents.createdAt, new Date(now.getTime() - MINUTE_MS)),
            ),
          );
        if ((recent?.n ?? 0) >= live.security.offersPerMinute) {
          throw tooMany('too_many_offers', 'Wait a minute before sending another price');
        }
        if (amountKobo === errand.feeKobo)
          throw unprocessable('offer_unchanged', 'The new price is the same as the current fee');
        if (amountKobo < settings.pricing.minFeeKobo) {
          throw unprocessable('fee_too_low', 'The fee is below the minimum', {
            minFeeKobo: settings.pricing.minFeeKobo,
          });
        }
        return { patch: { pendingOfferKobo: amountKobo }, record: { amountKobo, previousFeeKobo: errand.feeKobo } };
      }
      case 'raise_fee': {
        const { amountKobo } = this.parse('raise_fee', data);
        if (amountKobo <= errand.feeKobo) {
          throw unprocessable('fee_not_raised', 'The new fee must be higher than the current one', {
            feeKobo: errand.feeKobo,
          });
        }
        return {
          patch: { feeKobo: amountKobo, serviceFeeKobo: serviceFee(amountKobo, settings.fees) },
          record: { amountKobo, previousFeeKobo: errand.feeKobo },
        };
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
        const limit = await this.itemLimit(tx, errand, live);
        if (limit !== null && amountKobo > limit) {
          throw unprocessable(
            'item_limit',
            'This is more item money than this errand can hold. Contact support for big purchases.',
            {
              limitKobo: limit,
            },
          );
        }
        return { patch: { itemAmountKobo: amountKobo }, record: { amountKobo, photos } };
      }
      case 'mark_delivered':
        await this.assertAtDropoff(tx, errand, live);
        return { patch: { deliveredAt: now }, record: {} };
      case 'confirm_pin': {
        const { pin } = this.parse('confirm_pin', data);
        const limit = settings.limits.pinAttempts;
        // Locked before this check existed: frozen now rather than opened again.
        if (errand.pinAttempts >= limit) return new PinLock(errand.pinAttempts);
        await this.assertAtDropoff(tx, errand, live);
        if (!this.pinMatches(errand, pin)) {
          const attempts = errand.pinAttempts + 1;
          if (attempts >= limit) return new PinLock(attempts);
          await tx.update(errands).set({ pinAttempts: attempts }).where(eq(errands.id, errand.id));
          // On the errand's record, for support and the customer: never the digits tried.
          await this.logEvent(tx, errand, 'pin_wrong', errand.status, 'agent', auth.userId, {
            attemptsLeft: limit - attempts,
          });
          return unprocessable('wrong_pin', 'That PIN is not right', { attemptsLeft: limit - attempts });
        }
        return { patch: {}, record: { method: 'pin' } };
      }
      case 'send_dropoff_photo': {
        // The photo is for a customer who isn't there: the agent waits at the drop-off first, and is still there.
        await this.assertAtDropoff(tx, errand, live);
        const waitMs = settings.timers.dropoffWaitMinutes * MINUTE_MS;
        const waited = errand.deliveredAt ? now.getTime() - errand.deliveredAt.getTime() : 0;
        if (waited < waitMs) {
          const minutes = Math.ceil((waitMs - waited) / MINUTE_MS);
          throw conflict(
            'dropoff_wait',
            `Wait ${minutes} more minute${minutes === 1 ? '' : 's'} at the drop-off before sending a photo`,
            { secondsLeft: Math.ceil((waitMs - waited) / 1000) },
          );
        }
        return { patch: {}, record: this.parse('send_dropoff_photo', data) };
      }
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
