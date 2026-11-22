import { Inject, Injectable, Logger } from '@nestjs/common';
import { DEFAULT_SECURITY_SETTINGS } from '@jiffo/shared';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { DB, type Db } from '../db/database.module';
import { countries, errandStops, errandTrail, errands } from '../db/schema';
import { CountriesService } from '../countries/countries.service';

const PRUNE_BATCH = 10_000;
/** Within this many metres of the pickup, the agent is there. */
const AT_PICKUP_METERS = 150;

export interface TrailPosition {
  lat: number;
  lng: number;
  mocked: boolean;
  accuracy: number | null;
  fixedAt: Date | null;
  at: Date;
}

/**
 * Where the agent was while out on each errand (docs/security-plan.md, G1, G3, G4, E6): written from the
 * phone's reports only for the errands whose customer follows the agent then, so being online alone leaves
 * no trail, and an errand held while the agent carries out another gets none until it is under way.
 */
@Injectable()
export class TrailService {
  private readonly logger = new Logger(TrailService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly countriesService: CountriesService,
  ) {}

  /** A position the agent's phone reported, for each errand they are out on. */
  async record(agentId: string, errandIds: string[], position: TrailPosition) {
    if (!errandIds.length) return;
    await this.db.insert(errandTrail).values(errandIds.map((errandId) => ({ errandId, agentId, ...position })));
    // Never a mocked position (MB4), nor one the phone says is far off: neither says where the agent is.
    if (!position.mocked && (position.accuracy === null || position.accuracy <= AT_PICKUP_METERS)) {
      await this.reachedPickup(agentId, errandIds, position);
    }
  }

  /**
   * The first time the agent holding an errand reports a position at its pickup (docs/matching.md, M15): for the
   * dashboard's predicted against actual pickup time. Kept on the errand, as the trail itself goes after a while.
   */
  private async reachedPickup(agentId: string, errandIds: string[], position: TrailPosition) {
    const here = sql`ST_SetSRID(ST_MakePoint(${position.lng}, ${position.lat}), 4326)::geography`;
    await this.db
      .update(errands)
      .set({ reachedPickupAt: position.at })
      .where(
        and(
          inArray(errands.id, errandIds),
          eq(errands.agentId, agentId),
          isNull(errands.reachedPickupAt),
          sql`exists (select 1 from ${errandStops} s where s.errand_id = ${errands.id} and s.seq = 0
            and ST_DWithin(s.location, ${here}, ${AT_PICKUP_METERS}))`,
        ),
      );
  }

  /**
   * Daily: points older than each country's Settings, Security say (90 days unless changed) go, unless
   * their errand is in dispute or a flag on it is still open, as a dispute or an investigation still needs
   * them (G4). A batch at a time, so a long backlog doesn't hold locks.
   */
  async prune() {
    let deleted = 0;
    const failed: string[] = [];
    for (const { code } of await this.db.select({ code: countries.code }).from(countries)) {
      // One country's settings that can't be read leaves the others to be pruned, and its own at 90 days.
      try {
        const current = await this.countriesService.currentSettingsIfAny(code);
        if (current) deleted += await this.pruneCountry(code, current.settings.security.trailDays);
      } catch (error) {
        failed.push(code);
        this.logger.error(`Pruning ${code}'s trails by its settings failed: ${(error as Error).message}`);
        deleted += await this.pruneCountry(code, DEFAULT_SECURITY_SETTINGS.trailDays).catch(() => 0);
      }
    }
    return { deleted, failed };
  }

  private async pruneCountry(countryCode: string, days: number) {
    let deleted = 0;
    for (;;) {
      const { rows } = await this.db.execute<{ id: number }>(sql`
        delete from ${errandTrail} where id in (
          select t.id from ${errandTrail} t join errands e on e.id = t.errand_id
          where e.country_code = ${countryCode}
            and t.at < now() - make_interval(days => ${days})
            and not exists (select 1 from errands e where e.id = t.errand_id and e.status = 'disputed')
            and not exists (select 1 from risk_flag_errands fe join risk_flags f on f.id = fe.flag_id
              where fe.errand_id = t.errand_id and f.status = 'open')
          limit ${PRUNE_BATCH})
        returning id`);
      deleted += rows.length;
      if (rows.length < PRUNE_BATCH) return deleted;
    }
  }
}
