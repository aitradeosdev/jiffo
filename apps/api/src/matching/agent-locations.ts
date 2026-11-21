import { Injectable } from '@nestjs/common';
import type { LatLng } from '../adapters/maps';
import { MatchingRedis } from './matching-redis';

const MINUTE_MS = 60_000;

/** An agent near a point, from their live position. */
export interface NearAgent extends LatLng {
  agentId: string;
  /** In a straight line. */
  meters: number;
}

/**
 * Where online agents are now (docs/matching.md, M2): a Redis geo set per country, with when each was last
 * seen, so the nearest agents to a pickup are found at once. Kept as the agent app reports; the database stays
 * the record, for trails and for the final check that an agent may take an errand. Per country rather than per
 * state, so agents near a state line are found from either side.
 */
@Injectable()
export class AgentLocations {
  constructor(private readonly redis: MatchingRedis) {}

  private keys(countryCode: string) {
    return { geo: `agents:geo:${countryCode}`, seen: `agents:seen:${countryCode}` };
  }

  /** The agent is online here now. */
  async put(agentId: string, countryCode: string, at: LatLng) {
    const { geo, seen } = this.keys(countryCode);
    await this.redis.client.multi().geoadd(geo, at.lng, at.lat, agentId).zadd(seen, Date.now(), agentId).exec();
  }

  /** The agent is offline, or their position says nothing (mocked). */
  async remove(agentId: string, countryCode: string) {
    const { geo, seen } = this.keys(countryCode);
    await this.redis.client.multi().zrem(geo, agentId).zrem(seen, agentId).exec();
  }

  /**
   * The agents within `radiusKm` of a point, nearest first, at most `count`, seen within `freshMinutes`.
   * Fails when Redis does, so the caller can ask the database instead.
   */
  async near(countryCode: string, at: LatLng, radiusKm: number, count: number, freshMinutes: number) {
    const { geo, seen } = this.keys(countryCode);
    const raw = (await this.redis.client.geosearch(
      geo,
      'FROMLONLAT',
      at.lng,
      at.lat,
      'BYRADIUS',
      radiusKm,
      'km',
      'ASC',
      'COUNT',
      count,
      'WITHCOORD',
      'WITHDIST',
    )) as Array<[string, string, [string, string]]>;
    if (!raw.length) return [];
    const scores = await this.redis.client.zmscore(seen, ...raw.map((r) => r[0]));
    const since = Date.now() - freshMinutes * MINUTE_MS;
    return raw.flatMap(([agentId, km, [lng, lat]], i): NearAgent[] =>
      Number(scores[i] ?? 0) >= since
        ? [{ agentId, meters: Math.round(Number(km) * 1000), lat: Number(lat), lng: Number(lng) }]
        : [],
    );
  }
}
