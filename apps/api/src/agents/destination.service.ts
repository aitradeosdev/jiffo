import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, isNull, sql } from 'drizzle-orm';
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
  async status(auth: Pick<AuthContext, 'userId' | 'countryCode'>) {
    const [{ settings }, [presence], used] = await Promise.all([
      this.countries.currentSettings(auth.countryCode),
      this.db
        .select({
          lat: agentPresence.destinationLat,
          lng: agentPresence.destinationLng,
          label: agentPresence.destinationLabel,
          setAt: agentPresence.destinationSetAt,
        })
        .from(agentPresence)
        .where(eq(agentPresence.userId, auth.userId)),
      this.usedToday(auth),
    ]);
    const { destinationMode, destinationUsesPerDay } = settings.matching;
    return {
      enabled: destinationMode,
      destination:
        presence?.lat != null && presence.lng != null
          ? { lat: presence.lat, lng: presence.lng, label: presence.label ?? '', setAt: presence.setAt }
          : null,
      usesPerDay: destinationUsesPerDay,
      usesLeft: Math.max(0, destinationUsesPerDay - used),
    };
  }

  /** How many destinations the agent set since the start of today, where they work. */
  private async usedToday(auth: Pick<AuthContext, 'userId' | 'countryCode'>) {
    const { timezone } = await this.countries.basics(auth.countryCode);
    const [row] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(agentDestinations)
      .where(
        and(
          eq(agentDestinations.agentId, auth.userId),
          gte(agentDestinations.setAt, sql`date_trunc('day', now() at time zone ${timezone}) at time zone ${timezone}`),
        ),
      );
    return row?.n ?? 0;
  }

  /** Heads for a place: a use of the day, also when it replaces one set before. */
  async set(auth: Pick<AuthContext, 'userId' | 'countryCode'>, input: LatLng & { label: string }) {
    const before = await this.status(auth);
    if (!before.enabled) throw conflict('destination_off', "Destination mode isn't available here");
    if (before.usesLeft <= 0) {
      throw conflict(
        'destination_limit',
        `You can set a destination ${before.usesPerDay} times a day. Try again tomorrow, or clear it to see every errand.`,
      );
    }
    const [presence] = await this.db
      .select({ lat: agentPresence.lat, lng: agentPresence.lng })
      .from(agentPresence)
      .where(eq(agentPresence.userId, auth.userId));
    if (presence?.lat == null || presence.lng == null) {
      throw conflict('location_needed', 'Turn on location to set where you are heading');
    }
    if (haversineMeters({ lat: presence.lat, lng: presence.lng }, input) <= ARRIVED_METERS) {
      throw unprocessable('destination_here', "You're there already");
    }
    const now = new Date();
    await this.db.transaction(async (tx) => {
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
      await this.end(tx, auth.userId, 'cleared', new Date());
      await this.forget(tx, auth.userId);
    });
    return this.status(auth);
  }

  /**
   * From a position the agent's phone reported: within a km of where they are heading, they are there, and it ends
   * (the app is told). `destination` is what the presence row held before this report.
   */
  async arrivedIfThere(agentId: string, at: LatLng, destination: LatLng | null) {
    if (!destination || haversineMeters(at, destination) > ARRIVED_METERS) return;
    await this.db.transaction(async (tx) => {
      await this.end(tx, agentId, 'arrived', new Date());
      await this.forget(tx, agentId);
    });
    this.realtime.toUser(agentId, 'agent', 'destination.updated', { destination: null, reason: 'arrived' });
  }

  private async end(db: Db | Tx, agentId: string, why: Ended, at: Date) {
    const [open] = await db
      .select({ id: agentDestinations.id })
      .from(agentDestinations)
      .where(and(eq(agentDestinations.agentId, agentId), isNull(agentDestinations.endedAt)))
      .orderBy(desc(agentDestinations.setAt))
      .limit(1);
    if (open) {
      await db
        .update(agentDestinations)
        .set({ endedAt: at, endedReason: why })
        .where(eq(agentDestinations.id, open.id));
    }
  }

  private async forget(db: Db | Tx, agentId: string) {
    await db
      .update(agentPresence)
      .set({ destinationLat: null, destinationLng: null, destinationLabel: null, destinationSetAt: null })
      .where(eq(agentPresence.userId, agentId));
  }
}
