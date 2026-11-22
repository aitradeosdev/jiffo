import { Inject, Injectable } from '@nestjs/common';
import {
  AGENT_OUT_STATES,
  CONFIRMED_PAIR_FLAG_KINDS,
  FAKE_GPS_FLAG_KINDS,
  PAIR_FLAG_KINDS,
  type CountrySettings,
  type MatchAgent,
  type MatchErrand,
  type MatchRefusal,
} from '@jiffo/shared';
import { and, eq, gt, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { completionRate, recentAccepts } from './completion';
import { AgentsService } from '../agents/agents.service';
import { conflict, forbidden, unprocessable, type ApiError } from '../common/errors';
import { DB, type Db, type Tx } from '../db/database.module';
import { agentPresence, errandEvents, errandStops, errands, matchBlocks, riskFlags, users } from '../db/schema';

const MINUTE_MS = 60_000;

/** The agent as matching sees them: where they are, and what each errand is checked against. */
export interface AgentNow extends MatchAgent {
  lat: number;
  lng: number;
}

/** What the agent is told when they may not get an errand. A flag is for staff, so it is never named. */
const REFUSALS: Record<MatchRefusal, () => ApiError> = {
  own_errand: () => forbidden('own_errand', "You can't take your own errand"),
  finish_urgent: () => conflict('finish_urgent', 'Finish your urgent errand before taking another'),
  busy: () => conflict('busy', 'Finish the errands you have before taking an urgent one'),
  too_many_errands: () => conflict('too_many_errands', 'Finish an errand you have before taking another'),
  category_off: () => unprocessable('category_off', "This errand's category is off in your preferences"),
  no_purchases: () => unprocessable('no_purchases', "You don't take errands that need buying items"),
  too_far: () => unprocessable('too_far', 'This pickup is too far from where you are'),
  unavailable: () => conflict('unavailable', "This errand isn't available to you"),
  gave_up: () => conflict('gave_up', 'You left this errand, so it goes to another agent'),
  completion_low: () =>
    conflict(
      'completion_low',
      'Scheduled errands go to agents who finish at least half the errands they accept. Finish more to take them.',
    ),
};

/**
 * Who may get an errand (docs/matching.md, M1). The agent's own state is checked first: online, where they say
 * and lately, and not held for faked GPS. Then each errand, through matchRefusal in @jiffo/shared: the board
 * shows only what passes, and accepting checks it again inside its transaction.
 */
@Injectable()
export class EligibilityService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly agents: AgentsService,
  ) {}

  refusal(code: MatchRefusal): ApiError {
    return REFUSALS[code]();
  }

  /**
   * How far the agent's position is from the errand's pickup, in metres, as PostGIS measures it on the earth's
   * shape: the one measure for accepting and for who could be offered it, so no one is shortlisted only to be
   * refused at the edge of their reach.
   */
  async pickupMeters(errandId: string, at: { lat: number; lng: number }, db: Db | Tx = this.db) {
    const { rows } = await db.execute<{ meters: number | string }>(sql`
      select ST_Distance(location, ST_SetSRID(ST_MakePoint(${at.lng}, ${at.lat}), 4326)::geography) as meters
      from errand_stops where errand_id = ${errandId} and seq = 0`);
    return Number(rows[0]?.meters ?? Infinity);
  }

  /** An errand as matching checks it for this agent, with what facts() found. */
  matchErrand(
    errand: {
      id: string;
      customerId: string;
      urgent: boolean;
      categoryKey: string;
      buy: boolean;
      scheduledFor: Date | null;
    },
    pickupMeters: number,
    agentId: string,
    facts: { apart: Set<string>; gaveUp: Set<string> },
  ): MatchErrand {
    return {
      customerId: errand.customerId,
      urgent: errand.urgent,
      categoryKey: errand.categoryKey,
      buy: errand.buy,
      pickupMeters,
      keptApart: agentId !== errand.customerId && facts.apart.has(errand.customerId),
      gaveUp: facts.gaveUp.has(errand.id),
      // Scheduled for later (M12): taken ahead. Once its time has come, it is an errand like any other.
      scheduled: !!errand.scheduledFor && errand.scheduledFor.getTime() > Date.now(),
    };
  }

  /** The agent now, or the reason they may not get any errand. */
  async agent(agentId: string, rules: CountrySettings['matching'], db: Db | Tx = this.db): Promise<AgentNow> {
    // As accepting checks it: an active account, with a name for the customer to see.
    const [account] = await db
      .select({ status: users.status, firstName: users.firstName })
      .from(users)
      .where(eq(users.id, agentId));
    if (account?.status !== 'active')
      throw forbidden('account_suspended', 'This account is suspended. Contact support.');
    if (!account.firstName) throw conflict('profile_incomplete', 'Add your name before taking errands');
    const [here] = await db
      .select({
        online: agentPresence.online,
        lat: agentPresence.lat,
        lng: agentPresence.lng,
        at: agentPresence.locatedAt,
        mocked: agentPresence.mocked,
      })
      .from(agentPresence)
      .where(eq(agentPresence.userId, agentId));
    if (!here?.online) throw conflict('go_online', 'Go online to see and take errands');
    const fresh = !!here.at && Date.now() - here.at.getTime() <= rules.locationFreshMinutes * MINUTE_MS;
    if (here.lat === null || here.lng === null || !fresh) {
      throw conflict('location_needed', 'Turn on location to see errands near you');
    }
    // A mocked position (MB4) says nothing about where the agent is.
    if (here.mocked) throw unprocessable('mock_location', 'Turn off mock location to see errands near you');
    if (rules.fakeGpsHoldHours > 0) {
      // A flag about the agent's own phone names them alone; one on an errand names its customer, then them.
      const [held] = await db
        .select({ id: riskFlags.id })
        .from(riskFlags)
        .where(
          and(
            inArray(riskFlags.kind, [...FAKE_GPS_FLAG_KINDS]),
            // Open or confirmed: only a flag staff cleared lets the agent work before the hold is over.
            ne(riskFlags.status, 'cleared'),
            gt(riskFlags.createdAt, new Date(Date.now() - rules.fakeGpsHoldHours * 60 * MINUTE_MS)),
            or(and(eq(riskFlags.userId, agentId), isNull(riskFlags.otherUserId)), eq(riskFlags.otherUserId, agentId)),
          ),
        )
        .limit(1);
      if (held) {
        throw conflict('location_review', "Jiffo is checking your phone's location. You can take errands again soon.");
      }
    }
    // One after the other, on the caller's connection: accepting asks inside its transaction, and a
    // transaction's connection runs one query at a time.
    const held = await db
      .select({
        urgent: errands.urgent,
        status: errands.status,
        scheduledFor: errands.scheduledFor,
        // Its final drop-off, which a back-to-back offer's pickup must be near (M10). The outer table by name: inside
        // a select, a column alone renders unqualified, which the subquery would take for its own.
        dropoffLat: sql<number | null>`(select s.lat from ${errandStops} s where s.errand_id = "errands"."id"
          order by s.seq desc limit 1)`,
        dropoffLng: sql<number | null>`(select s.lng from ${errandStops} s where s.errand_id = "errands"."id"
          order by s.seq desc limit 1)`,
        // Its pickup, which an agent holding a scheduled errand ahead must reach by its start (M12).
        pickupLat: sql<number | null>`(select s.lat from ${errandStops} s where s.errand_id = "errands"."id"
          and s.seq = 0)`,
        pickupLng: sql<number | null>`(select s.lng from ${errandStops} s where s.errand_id = "errands"."id"
          and s.seq = 0)`,
      })
      .from(errands)
      .where(and(eq(errands.agentId, agentId), inArray(errands.status, [...AGENT_OUT_STATES])));
    const prefs = await this.agents.profile(agentId, db);
    // Their completion rate, as ranking has it: for scheduled errands, which need half or more (M12).
    const {
      rows: [recent],
    } = await db.execute<{ accepted: number; withdrawn: number }>(recentAccepts(sql`${agentId}::uuid`));
    const now = Date.now();
    return {
      userId: agentId,
      completionRate: recent ? completionRate(recent) : null,
      lat: here.lat,
      lng: here.lng,
      categoryKeys: prefs.categoryKeys,
      takesPurchases: prefs.takesPurchases,
      workRadiusKm: prefs.workRadiusKm,
      held: held.map((e) => ({
        urgent: e.urgent,
        status: e.status,
        dropoff: e.dropoffLat === null || e.dropoffLng === null ? null : { lat: e.dropoffLat, lng: e.dropoffLng },
        startsAt: e.scheduledFor,
        pickup: e.pickupLat === null || e.pickupLng === null ? null : { lat: e.pickupLat, lng: e.pickupLng },
        // A scheduled errand taken ahead isn't under way until it starts.
        startsLater: e.status === 'accepted' && !!e.scheduledFor && e.scheduledFor.getTime() > now,
      })),
    };
  }

  /**
   * The board's query leaves out, before its limit, errands this agent may not take for who they are with or
   * what they did: a customer kept apart from them (a flag, or "Don't match me again" either way), and an
   * errand they left or were replaced on.
   */
  boardExclusions(agentId: string) {
    const list = (kinds: readonly string[]) =>
      sql.join(
        kinds.map((k) => sql`${k}`),
        sql`, `,
      );
    return and(
      sql`not exists (select 1 from risk_flags f
        where ((f.kind in (${list(PAIR_FLAG_KINDS)}) and f.status <> 'cleared')
          or (f.kind in (${list(CONFIRMED_PAIR_FLAG_KINDS)}) and f.status = 'confirmed'))
        and ((f.user_id = ${agentId} and f.other_user_id = ${errands.customerId})
          or (f.other_user_id = ${agentId} and f.user_id = ${errands.customerId})))`,
      sql`not exists (select 1 from match_blocks b
        where (b.user_id = ${agentId} and b.other_user_id = ${errands.customerId})
          or (b.other_user_id = ${agentId} and b.user_id = ${errands.customerId}))`,
      sql`not exists (select 1 from errand_events ev where ev.errand_id = ${errands.id}
        and ev.event in ('withdraw', 'release_agent', 'take_back') and ev.data->>'agentId' = ${agentId})`,
    );
  }

  /**
   * For these errands and this agent: the customers kept apart from the agent (a flag not cleared, or for
   * those that need it confirmed, or "Don't match me again" either way), and the errands the agent left or was
   * replaced on.
   */
  async facts(agentId: string, rows: Array<{ id: string; customerId: string }>, db: Db | Tx = this.db) {
    if (!rows.length) return { apart: new Set<string>(), gaveUp: new Set<string>() };
    const customers = [...new Set(rows.map((r) => r.customerId))];
    // One after the other, on the caller's connection (see agent()).
    const flags = await db
      .select({ userId: riskFlags.userId, otherUserId: riskFlags.otherUserId })
      .from(riskFlags)
      .where(
        and(
          or(
            and(inArray(riskFlags.kind, [...PAIR_FLAG_KINDS]), ne(riskFlags.status, 'cleared')),
            and(inArray(riskFlags.kind, [...CONFIRMED_PAIR_FLAG_KINDS]), eq(riskFlags.status, 'confirmed')),
          ),
          or(
            and(eq(riskFlags.userId, agentId), inArray(riskFlags.otherUserId, customers)),
            and(eq(riskFlags.otherUserId, agentId), inArray(riskFlags.userId, customers)),
          ),
        ),
      );
    const blocks = await db
      .select({ userId: matchBlocks.userId, otherUserId: matchBlocks.otherUserId })
      .from(matchBlocks)
      .where(
        or(
          and(eq(matchBlocks.userId, agentId), inArray(matchBlocks.otherUserId, customers)),
          and(eq(matchBlocks.otherUserId, agentId), inArray(matchBlocks.userId, customers)),
        ),
      );
    const left = await db
      .select({ errandId: errandEvents.errandId })
      .from(errandEvents)
      .where(
        and(
          inArray(
            errandEvents.errandId,
            rows.map((r) => r.id),
          ),
          inArray(errandEvents.event, ['withdraw', 'release_agent', 'take_back']),
          sql`${errandEvents.data}->>'agentId' = ${agentId}`,
        ),
      );
    const otherOf = (r: { userId: string; otherUserId: string | null }) =>
      r.userId === agentId ? r.otherUserId! : r.userId;
    return {
      apart: new Set([...flags, ...blocks].map(otherOf)),
      gaveUp: new Set(left.map((l) => l.errandId)),
    };
  }
}
