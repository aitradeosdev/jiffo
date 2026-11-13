import { Inject, Injectable, Logger } from '@nestjs/common';
import { AGENT_OUT_STATES } from '@jiffo/shared';
import { and, eq, gt, inArray, isNotNull, lt, ne, sql } from 'drizzle-orm';
import { DB, type Db } from '../db/database.module';
import { agentPresence, errands } from '../db/schema';
import { AgentApplicationService } from './application.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import type { AuthContext } from '../auth/auth.types';

/** States in which the agent is out doing the errand, so the customer may see where they are. */
export const TRAVEL_STATES = AGENT_OUT_STATES;
/** A position not refreshed for this long is deleted, whatever the agent's app last said. */
const KEEP_FOR_MS = 30 * 60_000;

/** A location older than this is not shown to a customer. */
const SHOW_FOR_MS = 2 * 60_000;
/** An agent who hasn't reported for this long no longer counts as online nearby. */
const ONLINE_FOR_MS = 10 * 60_000;

const point = (lat: number, lng: number) => sql`ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography`;

/**
 * Whether agents are online and where they are. The agent app reports while the agent is online or has
 * an errand running; going offline with nothing running clears the location. A customer sees their own
 * agent's position during their errand, and while matching only how many agents are online nearby.
 */
@Injectable()
export class PresenceService {
  private readonly logger = new Logger('Presence');

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly realtime: RealtimeGateway,
    private readonly applications: AgentApplicationService,
  ) {}

  async report(auth: AuthContext, input: { online: boolean; lat?: number; lng?: number }) {
    const running = await this.db
      .select({ id: errands.id, customerId: errands.customerId })
      .from(errands)
      .where(and(eq(errands.agentId, auth.userId), inArray(errands.status, [...TRAVEL_STATES])));
    let body = input;
    // Going online is for approved agents; going offline always works. An agent not approved yet who still
    // has an errand running keeps sharing where they are for it, but isn't counted as online.
    if (input.online && !(await this.applications.approved(auth.userId))) {
      if (running.length === 0) await this.applications.assertApproved(auth.userId);
      body = { ...input, online: false };
    }
    const sharing = body.online || running.length > 0;
    const located = sharing && body.lat !== undefined && body.lng !== undefined;
    const now = new Date();
    const place = located
      ? { lat: body.lat!, lng: body.lng!, location: point(body.lat!, body.lng!), locatedAt: now }
      : sharing
        ? {}
        : { lat: null, lng: null, location: null, locatedAt: null };
    await this.db
      .insert(agentPresence)
      .values({ userId: auth.userId, countryCode: auth.countryCode, online: body.online, ...place, updatedAt: now })
      .onConflictDoUpdate({
        target: agentPresence.userId,
        set: { countryCode: auth.countryCode, online: body.online, ...place, updatedAt: now },
      });
    // An errand may have ended while this was being written: if the agent is offline and now idle,
    // forget the position again rather than keep it.
    if (!body.online && sharing) await this.forgetIfIdle(auth.userId);
    if (located) {
      for (const e of running) {
        this.realtime.toUser(e.customerId, 'customer', 'agent.location', {
          errandId: e.id,
          lat: body.lat,
          lng: body.lng,
          at: now,
        });
      }
    }
    return { online: body.online, sharingLocation: sharing };
  }

  /**
   * Deletes positions nobody has refreshed for a while (an app closed while online, say), and marks
   * those agents offline. Runs on a schedule.
   */
  async sweep() {
    const cleared = await this.db
      .update(agentPresence)
      .set({ online: false, lat: null, lng: null, location: null, locatedAt: null, updatedAt: new Date() })
      .where(and(isNotNull(agentPresence.locatedAt), lt(agentPresence.locatedAt, new Date(Date.now() - KEEP_FOR_MS))))
      .returning({ userId: agentPresence.userId });
    if (cleared.length) this.logger.log(`Cleared ${cleared.length} stale agent positions`);
    return cleared.length;
  }

  /** Clears the agent's location if they are offline and have no errand running. */
  async forgetIfIdle(agentId: string) {
    const [busy] = await this.db
      .select({ id: errands.id })
      .from(errands)
      .where(and(eq(errands.agentId, agentId), inArray(errands.status, [...TRAVEL_STATES])))
      .limit(1);
    if (busy) return;
    await this.db
      .update(agentPresence)
      .set({ lat: null, lng: null, location: null, locatedAt: null, updatedAt: new Date() })
      .where(and(eq(agentPresence.userId, agentId), eq(agentPresence.online, false)));
  }

  /**
   * Whether the agent counts as online now (switched on, and reported recently), and whether they have
   * an errand running, which means their app should keep sharing where they are.
   */
  async status(userId: string) {
    const [[row], [busy]] = await Promise.all([
      this.db.select().from(agentPresence).where(eq(agentPresence.userId, userId)),
      this.db
        .select({ id: errands.id })
        .from(errands)
        .where(and(eq(errands.agentId, userId), inArray(errands.status, [...TRAVEL_STATES])))
        .limit(1),
    ]);
    const fresh = !!row?.locatedAt && Date.now() - row.locatedAt.getTime() < ONLINE_FOR_MS;
    return { online: !!row?.online && fresh, onErrand: !!busy };
  }

  /** The agent's last position, if recent enough to show the customer. */
  async locationOf(agentId: string) {
    const [row] = await this.db
      .select({ lat: agentPresence.lat, lng: agentPresence.lng, at: agentPresence.locatedAt })
      .from(agentPresence)
      .where(eq(agentPresence.userId, agentId));
    if (!row?.at || row.lat === null || row.lng === null) return null;
    if (Date.now() - row.at.getTime() > SHOW_FOR_MS) return null;
    return { lat: row.lat, lng: row.lng, at: row.at };
  }

  /** How many agents are online within a radius of a point (never who or where). */
  async onlineNear(countryCode: string, lat: number, lng: number, radiusMeters: number, excludeUserId: string) {
    const [row] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(agentPresence)
      .where(
        and(
          eq(agentPresence.countryCode, countryCode),
          eq(agentPresence.online, true),
          ne(agentPresence.userId, excludeUserId),
          gt(agentPresence.locatedAt, new Date(Date.now() - ONLINE_FOR_MS)),
          sql`ST_DWithin(${agentPresence.location}, ${point(lat, lng)}, ${radiusMeters})`,
        ),
      );
    return row?.n ?? 0;
  }
}
