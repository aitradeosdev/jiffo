import { Inject, Injectable } from '@nestjs/common';
import {
  AGENT_OUT_STATES,
  FAKE_GPS_FLAG_KINDS,
  PAIR_FLAG_KINDS,
  type CountrySettings,
  type MatchAgent,
  type MatchRefusal,
} from '@jiffo/shared';
import { and, eq, gt, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { AgentsService } from '../agents/agents.service';
import { conflict, forbidden, unprocessable, type ApiError } from '../common/errors';
import { DB, type Db, type Tx } from '../db/database.module';
import { agentPresence, errandEvents, errands, riskFlags } from '../db/schema';

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

  /** The agent now, or the reason they may not get any errand. */
  async agent(agentId: string, rules: CountrySettings['matching'], db: Db | Tx = this.db): Promise<AgentNow> {
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
            eq(riskFlags.status, 'open'),
            gt(riskFlags.createdAt, new Date(Date.now() - rules.fakeGpsHoldHours * 60 * MINUTE_MS)),
            or(and(eq(riskFlags.userId, agentId), isNull(riskFlags.otherUserId)), eq(riskFlags.otherUserId, agentId)),
          ),
        )
        .limit(1);
      if (held) {
        throw conflict('location_review', "Jiffo is checking your phone's location. You can take errands again soon.");
      }
    }
    const [held, prefs] = await Promise.all([
      db
        .select({ urgent: errands.urgent, status: errands.status, scheduledFor: errands.scheduledFor })
        .from(errands)
        .where(and(eq(errands.agentId, agentId), inArray(errands.status, [...AGENT_OUT_STATES]))),
      this.agents.profile(agentId),
    ]);
    const now = Date.now();
    return {
      userId: agentId,
      lat: here.lat,
      lng: here.lng,
      categoryKeys: prefs.categoryKeys,
      takesPurchases: prefs.takesPurchases,
      held: held.map((e) => ({
        urgent: e.urgent,
        // A scheduled errand taken ahead isn't under way until it starts.
        startsLater: e.status === 'accepted' && !!e.scheduledFor && e.scheduledFor.getTime() > now,
      })),
    };
  }

  /**
   * For these errands and this agent: the customers flagged with the agent (not cleared), and the errands the
   * agent left or was replaced on.
   */
  async facts(agentId: string, rows: Array<{ id: string; customerId: string }>, db: Db | Tx = this.db) {
    if (!rows.length) return { pairs: new Set<string>(), gaveUp: new Set<string>() };
    const customers = [...new Set(rows.map((r) => r.customerId))];
    const [flags, left] = await Promise.all([
      db
        .select({ userId: riskFlags.userId, otherUserId: riskFlags.otherUserId })
        .from(riskFlags)
        .where(
          and(
            inArray(riskFlags.kind, [...PAIR_FLAG_KINDS]),
            ne(riskFlags.status, 'cleared'),
            or(
              and(eq(riskFlags.userId, agentId), inArray(riskFlags.otherUserId, customers)),
              and(eq(riskFlags.otherUserId, agentId), inArray(riskFlags.userId, customers)),
            ),
          ),
        ),
      db
        .select({ errandId: errandEvents.errandId })
        .from(errandEvents)
        .where(
          and(
            inArray(
              errandEvents.errandId,
              rows.map((r) => r.id),
            ),
            inArray(errandEvents.event, ['withdraw', 'release_agent']),
            sql`${errandEvents.data}->>'agentId' = ${agentId}`,
          ),
        ),
    ]);
    return {
      pairs: new Set(flags.map((f) => (f.userId === agentId ? f.otherUserId! : f.userId))),
      gaveUp: new Set(left.map((l) => l.errandId)),
    };
  }
}
