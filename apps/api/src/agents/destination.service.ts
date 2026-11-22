import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gte, isNull, sql } from 'drizzle-orm';
import { haversineMeters, type LatLng } from '@jiffo/shared';
import type { AuthContext } from '../auth/auth.types';
import { conflict, unprocessable } from '../common/errors';
import { CountriesService } from '../countries/countries.service';
import { DB, type Db, type Tx } from '../db/database.module';
import { agentDestinations, agentPresence } from '../db/schema';
import { RealtimeGateway } from '../realtime/realtime.gateway';

/** Within this far of their destination, the agent is there, and it ends. */
export const ARRIVED_METERS = 1_000;

type Ended = 'arrived' | 'cleared' | 'replaced';

/**
 * Destination mode (docs/matching.md, M13), as Uber's and Bolt's: an agent sets where they are heading, such as
 * home, a few times a day (Settings, Matching), and gets only errands whose drop-off brings them closer. It ends
 * when they get there or clear it.
 */
@Injectable()
export class DestinationService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly countries: CountriesService,
    private readonly realtime: RealtimeGateway,
  ) {}

  /** Where they are heading, if anywhere, and how many more they may set today, by the country's own clock. */
  async status(auth: Pick<AuthContext, 'userId' | 'countryCode'>, db: Db | Tx = this.db) {
    const [{ settings }, { timezone }] = await Promise.all([
      this.countries.currentSettings(auth.countryCode),
      this.countries.basics(auth.countryCode),
    ]);
    const [presence] = await db
      .select({
        lat: agentPresence.destinationLat,
        lng: agentPresence.destinationLng,
        label: agentPresence.destinationLabel,
        setAt: agentPresence.destinationSetAt,
        // A destination lasts the day it was set, so one from another day never narrows today's errands.
        today: sql<boolean>`${agentPresence.destinationSetAt} >= ${startOfToday(timezone)}`,
      })
      .from(agentPresence)
      .where(eq(agentPresence.userId, auth.userId));
    const [used] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(agentDestinations)
      .where(and(eq(agentDestinations.agentId, auth.userId), gte(agentDestinations.setAt, startOfToday(timezone))));
    const { destinationMode, destinationUsesPerDay } = settings.matching;
    return {
      enabled: destinationMode,
      destination:
        presence?.lat != null && presence.lng != null && presence.today
          ? { lat: presence.lat, lng: presence.lng, label: presence.label ?? '', setAt: presence.setAt }
          : null,
      usesPerDay: destinationUsesPerDay,
      usesLeft: Math.max(0, destinationUsesPerDay - (used?.n ?? 0)),
    };
  }

  /** Heads for a place: a use of the day, also when it replaces one set before. One change at a time per agent. */
  async set(auth: Pick<AuthContext, 'userId' | 'countryCode'>, input: LatLng & { label: string }) {
    const { settings } = await this.countries.currentSettings(auth.countryCode);
    const now = new Date();
    await this.db.transaction(async (tx) => {
      await lock(tx, auth.userId);
      // Counted under the lock, so two at once can't both take the last of the day's.
      const before = await this.status(auth, tx);
      if (!before.enabled) throw conflict('destination_off', "Destination mode isn't available here");
      if (before.usesLeft <= 0) {
        throw conflict(
          'destination_limit',
          `You can set a destination ${before.usesPerDay} times a day. Try again tomorrow, or clear it to see every errand.`,
        );
      }
      // Already there, by a recent position the phone didn't say was mocked; otherwise it can't be told.
      const [presence] = await tx
        .select({
          lat: agentPresence.lat,
          lng: agentPresence.lng,
          at: agentPresence.locatedAt,
          mocked: agentPresence.mocked,
        })
        .from(agentPresence)
        .where(eq(agentPresence.userId, auth.userId));
      if (!presence) throw conflict('location_needed', 'Turn on location to set where you are heading');
      const fresh =
        presence.lat != null &&
        presence.lng != null &&
        !presence.mocked &&
        !!presence.at &&
        now.getTime() - presence.at.getTime() <= settings.matching.locationFreshMinutes * 60_000;
      if (fresh && haversineMeters({ lat: presence.lat!, lng: presence.lng! }, input) <= ARRIVED_METERS) {
        throw unprocessable('destination_here', "You're there already");
      }
      await this.end(tx, auth.userId, 'replaced', now);
      await tx
        .insert(agentDestinations)
        .values({ agentId: auth.userId, countryCode: auth.countryCode, ...input, setAt: now });
      await tx
        .update(agentPresence)
        .set({
          destinationLat: input.lat,
          destinationLng: input.lng,
          destinationLabel: input.label,
          destinationSetAt: now,
        })
        .where(eq(agentPresence.userId, auth.userId));
    });
    return this.status(auth);
  }

  /** Every errand again. */
  async clear(auth: Pick<AuthContext, 'userId' | 'countryCode'>) {
    await this.db.transaction(async (tx) => {
      await lock(tx, auth.userId);
      await this.end(tx, auth.userId, 'cleared', new Date());
      await this.forget(tx, auth.userId);
    });
    return this.status(auth);
  }

  /**
   * From a position the agent's phone reported: within a km of where they are heading, they are there, and it ends
   * (the app is told). `destination` is what the presence row held when the report was read: one set since is
   * theirs to keep.
   */
  async arrivedIfThere(agentId: string, at: LatLng, destination: (LatLng & { setAt: Date | null }) | null) {
    if (!destination?.setAt || haversineMeters(at, destination) > ARRIVED_METERS) return;
    const ended = await this.db.transaction(async (tx) => {
      await lock(tx, agentId);
      const [still] = await tx
        .update(agentPresence)
        .set({ destinationLat: null, destinationLng: null, destinationLabel: null, destinationSetAt: null })
        .where(and(eq(agentPresence.userId, agentId), eq(agentPresence.destinationSetAt, destination.setAt!)))
        .returning({ userId: agentPresence.userId });
      if (!still) return false;
      await this.end(tx, agentId, 'arrived', new Date());
      return true;
    });
    if (ended) this.realtime.toUser(agentId, 'agent', 'destination.updated', { destination: null, reason: 'arrived' });
  }

  /** Ends every destination still open for the agent. */
  private async end(db: Db | Tx, agentId: string, why: Ended, at: Date) {
    await db
      .update(agentDestinations)
      .set({ endedAt: at, endedReason: why })
      .where(and(eq(agentDestinations.agentId, agentId), isNull(agentDestinations.endedAt)));
  }

  private async forget(db: Db | Tx, agentId: string) {
    await db
      .update(agentPresence)
      .set({ destinationLat: null, destinationLng: null, destinationLabel: null, destinationSetAt: null })
      .where(eq(agentPresence.userId, agentId));
  }
}

/** One destination change at a time per agent. */
const lock = (tx: Tx, agentId: string) =>
  tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'destination:' + agentId}))`);

/** The start of today where the agent works, by the country's own clock. */
export const startOfToday = (timezone: string) =>
  sql`(date_trunc('day', now() at time zone ${timezone}) at time zone ${timezone})`;
