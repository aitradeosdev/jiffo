import { Inject, Injectable, Logger } from '@nestjs/common';
import type { CountrySettings } from '@jiffo/shared';
import { MAPS, type LatLng, type MapsAdapter, type RouteEstimate } from '../adapters/maps';
import { MatchingRedis } from './matching-redis';

/** How long a provider's travel time is used again for the same agent and pickup. */
const CACHE_SECONDS = 60;
/** Roads wind about 30% more than a straight line. */
const ROAD_FACTOR = 1.3;

/** How long an agent takes to reach a pickup by road; estimated when the maps provider couldn't say. */
export interface Travel extends RouteEstimate {
  estimated: boolean;
}

/** Where a pickup is, to about 100 m: travel times to anywhere in it are taken as the same. */
const cellOf = (p: LatLng) => `${p.lat.toFixed(3)},${p.lng.toFixed(3)}`;

/**
 * Road travel time from agents to a pickup (docs/matching.md, M3), from whichever maps provider is switched
 * on, with live traffic. Each answer is kept for a minute per agent and pickup cell, and an agent the provider
 * can't route, or every agent when it fails, gets a straight-line estimate at the Matching settings' speed,
 * which is logged.
 */
@Injectable()
export class TravelTimesService {
  private readonly logger = new Logger('TravelTimes');

  constructor(
    private readonly redis: MatchingRedis,
    @Inject(MAPS) private readonly maps: MapsAdapter,
  ) {}

  static estimate(straightMeters: number, rules: Pick<CountrySettings['matching'], 'fallbackSpeedKmh'>): Travel {
    const distanceMeters = Math.round(straightMeters * ROAD_FACTOR);
    return {
      distanceMeters,
      durationSeconds: Math.round((straightMeters * ROAD_FACTOR) / (rules.fallbackSpeedKmh / 3.6)),
      estimated: true,
    };
  }

  async toPickup(
    agents: Array<{ agentId: string; lat: number; lng: number; straightMeters: number }>,
    pickup: LatLng,
    rules: Pick<CountrySettings['matching'], 'fallbackSpeedKmh'>,
  ): Promise<Map<string, Travel>> {
    const found = new Map<string, Travel>();
    if (!agents.length) return found;
    const cell = cellOf(pickup);
    const keyOf = (agentId: string) => `travel:${agentId}:${cell}`;
    const cached = await this.redis.client
      .mget(...agents.map((a) => keyOf(a.agentId)))
      .catch(() => agents.map(() => null));
    agents.forEach((a, i) => {
      const hit = cached[i];
      if (hit) found.set(a.agentId, { ...(JSON.parse(hit) as RouteEstimate), estimated: false });
    });
    const asking = agents.filter((a) => !found.has(a.agentId));
    if (!asking.length) return found;

    let answers: Array<RouteEstimate | null>;
    let failure: string | null = null;
    try {
      answers = await this.maps.travelTimes(asking, pickup);
    } catch (error) {
      failure = (error as Error).message;
      answers = asking.map(() => null);
    }
    const keep = this.redis.client.multi();
    let estimated = 0;
    asking.forEach((a, i) => {
      const answer = answers[i];
      if (answer) {
        found.set(a.agentId, { ...answer, estimated: false });
        keep.set(keyOf(a.agentId), JSON.stringify(answer), 'EX', CACHE_SECONDS);
      } else {
        found.set(a.agentId, TravelTimesService.estimate(a.straightMeters, rules));
        estimated += 1;
      }
    });
    await keep.exec().catch(() => undefined);
    if (estimated) {
      this.logger.warn(
        `Estimated travel times for ${estimated} of ${asking.length} agents (${this.maps.name})` +
          (failure ? `: the provider failed (${failure})` : ': no route found'),
      );
    }
    return found;
  }
}
