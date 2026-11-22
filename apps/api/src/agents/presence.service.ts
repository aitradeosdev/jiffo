import { Inject, Injectable, Logger } from '@nestjs/common';
import { AGENT_OUT_STATES } from '@jiffo/shared';
import { and, eq, gt, inArray, isNotNull, lt, ne, sql } from 'drizzle-orm';
import { DB, type Db } from '../db/database.module';
import { agentPresence, errands, type SelfieReason } from '../db/schema';
import { AttestationService, type AttestContext } from '../attestation/attestation.service';
import { AgentApplicationService } from './application.service';
import { AgentSelfieService } from './agent-selfie.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { RiskFlagsService } from '../risk/risk-flags.service';
import { TrailService } from './trail.service';
import { AgentLocations } from '../matching/agent-locations';
import type { LatLng } from '../adapters/maps';
import type { AuthContext } from '../auth/auth.types';

/** States in which the agent is out doing the errand, so the customer may see where they are. */
export const TRAVEL_STATES = AGENT_OUT_STATES;
/**
 * When the customer sees where the agent is: while the agent is on the way for them, up to the drop-off.
 * After a drop-off photo, or once the customer is unreachable, the agent's position is their own again.
 */
export const SHARE_STATES: readonly string[] = AGENT_OUT_STATES.filter(
  (s) => s !== 'photo_pending' && s !== 'unreachable',
);
/** The errand is under way (not just accepted): the agent is out doing it right now. */
const UNDER_WAY: readonly string[] = SHARE_STATES.filter((s) => s !== 'accepted');

/**
 * Which of an agent's running errands get the agent's position: the ones in SHARE_STATES, but while one is
 * under way, only those under way. An agent holding a second errand they haven't started isn't followed by
 * that customer while they carry out the first (docs/security-plan.md, G2).
 */
export function sharedWith<T extends { status: string }>(running: T[]): T[] {
  const shown = running.filter((r) => SHARE_STATES.includes(r.status));
  const underWay = shown.filter((r) => UNDER_WAY.includes(r.status));
  return underWay.length ? underWay : shown;
}

/** A fix the phone says it took longer ago than this, or further ahead than this, isn't believed. */
const FIX_PAST_MS = 10 * 60_000;
const FIX_AHEAD_MS = 60_000;

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
    private readonly selfie: AgentSelfieService,
    private readonly attestation: AttestationService,
    private readonly trail: TrailService,
    private readonly risk: RiskFlagsService,
    private readonly locations: AgentLocations,
  ) {}

  /**
   * Matching's live positions (docs/matching.md, M2): an online agent where their phone really is, and no one
   * offline or whose position is mocked. Not waited for, so Redis never holds up an agent's report; on one
   * connection, so the writes keep their order. A failed write is logged; the database stays the record that
   * matching checks before anyone gets an errand.
   */
  private keepLive(agentId: string, countryCode: string, online: boolean, mocked: boolean, at?: LatLng) {
    const write =
      !online || mocked
        ? this.locations.remove(agentId, countryCode)
        : at
          ? this.locations.put(agentId, countryCode, at)
          : Promise.resolve();
    write.catch((error: Error) => this.logger.warn(`Keeping a live position failed: ${error.message}`));
  }

  /**
   * Going online or offline, and where the agent is. Without `online` (the app reporting from the
   * background), the agent stays online or offline as they last chose, or as support or the sweep left them.
   */
  async report(
    auth: AuthContext,
    input: {
      online?: boolean;
      lat?: number;
      lng?: number;
      mocked?: boolean;
      accuracy?: number;
      fixedAt?: number;
      tapped?: boolean;
    },
    attest?: Pick<AttestContext, 'evidence' | 'request'>,
  ) {
    const [running, [current]] = await Promise.all([
      this.db
        .select({ id: errands.id, customerId: errands.customerId, status: errands.status })
        .from(errands)
        .where(and(eq(errands.agentId, auth.userId), inArray(errands.status, [...TRAVEL_STATES]))),
      this.db
        .select({
          online: agentPresence.online,
          lat: agentPresence.lat,
          lng: agentPresence.lng,
          locatedAt: agentPresence.locatedAt,
          mocked: agentPresence.mocked,
          accuracy: agentPresence.accuracy,
          fixedAt: agentPresence.fixedAt,
          offlineReason: agentPresence.offlineReason,
        })
        .from(agentPresence)
        .where(eq(agentPresence.userId, auth.userId)),
    ]);
    let body = { ...input, online: input.online ?? current?.online ?? false };
    // Taken offline for missed offers (docs/matching.md, M6): back online only by going online themselves, not
    // by the app's heartbeat still saying online, which is told they're offline and why.
    const heldOffline = current?.offlineReason === 'missed_offers' && !input.tapped ? current.offlineReason : null;
    if (heldOffline) body = { ...body, online: false };
    // Going online is for approved agents; going offline always works. An agent not approved yet who still
    // has an errand running keeps sharing where they are for it, but isn't counted as online.
    if (body.online && !(await this.applications.approved(auth.userId))) {
      if (running.length === 0 && input.online) await this.applications.assertApproved(auth.userId);
      body = { ...body, online: false };
    }
    // Going online (not staying online, as the app's heartbeat says) needs today's selfie first (I8), then
    // the app check (MB3), whose doubts ask for a selfie too. An agent already online stays so past midnight,
    // and is asked the next time they go online. One with an errand running is kept sharing where they are
    // for it, offline, whatever stops them going online: told a selfie is still to take, or refused the check.
    let selfieNeeded: SelfieReason | null = null;
    if (body.online && !current?.online) {
      selfieNeeded = await this.selfie.neededToGoOnline(auth);
      // The day's selfie is asked for before the check is used, so the app sends the same check again after.
      if (!selfieNeeded) {
        try {
          const attested = await this.attestation.enforceSession(auth, 'go_online', {
            evidence: attest?.evidence ?? {},
            request: attest?.request ?? { method: 'PUT', path: '/v1/agent/presence', body: undefined },
          });
          if (attested === 'doubtful') selfieNeeded = await this.selfie.neededOnDoubtfulPhone(auth);
        } catch (error) {
          if (running.length === 0) throw error;
          body = { ...body, online: false };
        }
      }
      if (selfieNeeded && running.length === 0) throw this.selfie.needed(selfieNeeded);
      if (selfieNeeded) body = { ...body, online: false };
    }
    const sharing = body.online || running.length > 0;
    const located = sharing && body.lat !== undefined && body.lng !== undefined;
    const now = new Date();
    // When the phone took the fix, if it is believable: the phone's clock, within a few minutes of ours.
    const fixedAt =
      body.fixedAt !== undefined &&
      body.fixedAt > now.getTime() - FIX_PAST_MS &&
      body.fixedAt < now.getTime() + FIX_AHEAD_MS
        ? new Date(body.fixedAt)
        : null;
    const accuracy = body.accuracy ?? null;
    const place = located
      ? {
          lat: body.lat!,
          lng: body.lng!,
          location: point(body.lat!, body.lng!),
          locatedAt: now,
          mocked: !!body.mocked,
          accuracy,
          fixedAt,
        }
      : sharing
        ? {}
        : { lat: null, lng: null, location: null, locatedAt: null, accuracy: null, fixedAt: null };
    // When they went online, which how long they've waited counts from (matching, M4): set going online, kept
    // while they stay so, cleared going offline. Decided in the write itself, so a report racing another can't
    // leave an online agent without one.
    const since = { onlineSince: body.online ? sql`coalesce(${agentPresence.onlineSince}, ${now})` : null };
    // Online again, or offline by their own choice: why Jiffo took them offline no longer matters.
    const reason = body.online || input.online === false ? { offlineReason: null } : {};
    await this.db
      .insert(agentPresence)
      .values({
        userId: auth.userId,
        countryCode: auth.countryCode,
        online: body.online,
        ...place,
        ...(body.online ? { onlineSince: now } : {}),
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: agentPresence.userId,
        set: { countryCode: auth.countryCode, online: body.online, ...place, ...since, ...reason, updatedAt: now },
      });
    this.keepLive(
      auth.userId,
      auth.countryCode,
      body.online,
      !!body.mocked,
      located ? { lat: body.lat!, lng: body.lng! } : undefined,
    );
    // An errand may have ended while this was being written: if the agent is offline and now idle,
    // forget the position again rather than keep it.
    if (!body.online && sharing) await this.forgetIfIdle(auth.userId);
    const following = sharedWith(running);
    // A mocked position (MB4) isn't sent on: it says nothing about where the agent is.
    if (located && !body.mocked) {
      for (const e of following) {
        this.realtime.toUser(e.customerId, 'customer', 'agent.location', {
          errandId: e.id,
          lat: body.lat,
          lng: body.lng,
          at: now,
        });
      }
    }
    if (located) {
      const position = { lat: body.lat!, lng: body.lng!, mocked: !!body.mocked, accuracy, fixedAt, at: now };
      // Kept for the errands whose customer follows the agent now (G1, G4, E6), beside the report: a failed
      // write is logged rather than failing the agent's report.
      await this.trail
        .record(
          auth.userId,
          following.map((e) => e.id),
          position,
        )
        .catch((error: Error) => this.logger.warn(`Keeping a trail point failed: ${error.message}`));
      // Whether they reached the pickup of any errand they hold (M15), as the trail does, never failing the report.
      await this.trail
        .reachedPickup(
          auth.userId,
          running.map((e) => e.id),
          position,
        )
        .catch((error: Error) => this.logger.warn(`Noting arrival at a pickup failed: ${error.message}`));
      // Checked against the last position (G1): by when the phone took each fix when both say, else by
      // when each reached us.
      const byPhone = !!(current?.fixedAt && fixedAt);
      const before =
        current?.lat != null && current.lng != null && current.locatedAt
          ? {
              lat: current.lat,
              lng: current.lng,
              at: byPhone ? current.fixedAt! : current.locatedAt,
              accuracy: current.accuracy,
              mocked: current.mocked,
            }
          : null;
      this.risk.positionReported({
        agentId: auth.userId,
        countryCode: auth.countryCode,
        before,
        after: { ...position, at: byPhone ? fixedAt! : now },
        running: following,
      });
    }
    return {
      online: body.online,
      sharingLocation: sharing,
      ...(selfieNeeded ? { selfieNeeded } : {}),
      ...(heldOffline ? { offlineReason: heldOffline } : {}),
    };
  }

  /**
   * Deletes positions nobody has refreshed for a while (an app closed while online, say), and marks
   * those agents offline. Runs on a schedule.
   */
  async sweep() {
    const cleared = await this.db
      .update(agentPresence)
      .set({
        online: false,
        lat: null,
        lng: null,
        location: null,
        locatedAt: null,
        accuracy: null,
        fixedAt: null,
        updatedAt: new Date(),
      })
      .where(and(isNotNull(agentPresence.locatedAt), lt(agentPresence.locatedAt, new Date(Date.now() - KEEP_FOR_MS))))
      .returning({ userId: agentPresence.userId, countryCode: agentPresence.countryCode });
    for (const c of cleared) this.keepLive(c.userId, c.countryCode, false, false);
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
      .set({
        lat: null,
        lng: null,
        location: null,
        locatedAt: null,
        accuracy: null,
        fixedAt: null,
        updatedAt: new Date(),
      })
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
    // Why Jiffo took them offline, if it did, so the app can say so.
    return { online: !!row?.online && fresh, onErrand: !!busy, offlineReason: row?.offlineReason ?? null };
  }

  /** The agent's position for this errand's customer, if the errand gets it now (sharedWith) and it's recent. */
  async locationFor(errandId: string, agentId: string) {
    const running = await this.db
      .select({ id: errands.id, status: errands.status })
      .from(errands)
      .where(and(eq(errands.agentId, agentId), inArray(errands.status, [...TRAVEL_STATES])));
    return sharedWith(running).some((e) => e.id === errandId) ? this.locationOf(agentId) : null;
  }

  /** The agent's last position, if recent enough to show the customer. */
  private async locationOf(agentId: string) {
    const [row] = await this.db
      .select({
        lat: agentPresence.lat,
        lng: agentPresence.lng,
        at: agentPresence.locatedAt,
        mocked: agentPresence.mocked,
      })
      .from(agentPresence)
      .where(eq(agentPresence.userId, agentId));
    if (!row?.at || row.lat === null || row.lng === null || row.mocked) return null;
    if (Date.now() - row.at.getTime() > SHOW_FOR_MS) return null;
    return { lat: row.lat, lng: row.lng, at: row.at };
  }

  /**
   * How many agents are online within a radius of a customer's pickup (never who or where), counting only those
   * the errand could reach: not the customer, not past an agent's own work radius, and not kept apart by
   * "Don't match me again" either way.
   */
  async onlineNear(countryCode: string, lat: number, lng: number, radiusMeters: number, customerId: string) {
    const here = point(lat, lng);
    const [row] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(agentPresence)
      .where(
        and(
          eq(agentPresence.countryCode, countryCode),
          eq(agentPresence.online, true),
          eq(agentPresence.mocked, false),
          ne(agentPresence.userId, customerId),
          gt(agentPresence.locatedAt, new Date(Date.now() - ONLINE_FOR_MS)),
          sql`ST_DWithin(${agentPresence.location}, ${here}, ${radiusMeters})`,
          sql`not exists (select 1 from agent_profiles ap where ap.user_id = ${agentPresence.userId}
            and ap.work_radius_km is not null
            and not ST_DWithin(${agentPresence.location}, ${here}, ap.work_radius_km * 1000))`,
          sql`not exists (select 1 from match_blocks b
            where (b.user_id = ${customerId} and b.other_user_id = ${agentPresence.userId})
              or (b.other_user_id = ${customerId} and b.user_id = ${agentPresence.userId}))`,
        ),
      );
    return row?.n ?? 0;
  }
}
