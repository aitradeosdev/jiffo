import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, inArray, ne, sql } from 'drizzle-orm';
import { DB, type Db } from '../db/database.module';
import { agentPresence, errands } from '../db/schema';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import type { AuthContext } from '../auth/auth.types';

/** States in which the agent is out doing the errand, so the customer may see where they are. */
export const TRAVEL_STATES = [
  'accepted',
  'started',
  'item_pending',
  'items_locked',
  'delivered',
  'photo_pending',
  'unreachable',
] as const;

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
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly realtime: RealtimeGateway,
  ) {}

  async report(auth: AuthContext, body: { online: boolean; lat?: number; lng?: number }) {
    const running = await this.db
      .select({ id: errands.id, customerId: errands.customerId })
      .from(errands)
      .where(and(eq(errands.agentId, auth.userId), inArray(errands.status, [...TRAVEL_STATES])));
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

  /** Whether the agent counts as online now: switched on, and reported recently. */
  async status(userId: string) {
    const [row] = await this.db.select().from(agentPresence).where(eq(agentPresence.userId, userId));
    const fresh = !!row?.locatedAt && Date.now() - row.locatedAt.getTime() < ONLINE_FOR_MS;
    return { online: !!row?.online && fresh };
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
