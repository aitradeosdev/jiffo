import { describe, expect, it } from 'vitest';
import { FakeMapsAdapter, GoogleMapsAdapter, MapboxMapsAdapter } from '../src/adapters/maps';

type Call = { url: string; init: RequestInit };

function fakeFetch(respond: (call: Call) => Response) {
  const calls: Call[] = [];
  const impl = (async (url: string | URL, init: RequestInit = {}) => {
    const call = { url: String(url), init };
    calls.push(call);
    return respond(call);
  }) as typeof fetch;
  return { impl, calls };
}

const PICKUP = { lat: 6.4474, lng: 3.4723 };
const agents = (n: number) => Array.from({ length: n }, (_, i) => ({ lat: 6.44 + i / 1000, lng: 3.46 + i / 1000 }));

/**
 * How long each nearby agent takes to reach a pickup by road (docs/matching.md, M3), from whichever maps
 * provider is switched on: Google's Route Matrix or Mapbox's Matrix, both with live traffic.
 */
describe('travel times to a pickup', () => {
  describe('Google', () => {
    it("asks Google's Route Matrix, with live traffic, for every agent to the one pickup", async () => {
      const { impl, calls } = fakeFetch(() =>
        Response.json([
          { originIndex: 1, destinationIndex: 0, condition: 'ROUTE_EXISTS', distanceMeters: 2_400, duration: '420s' },
          { originIndex: 0, destinationIndex: 0, condition: 'ROUTE_EXISTS', distanceMeters: 900, duration: '180s' },
          { originIndex: 2, destinationIndex: 0, condition: 'ROUTE_NOT_FOUND' },
        ]),
      );
      const times = await new GoogleMapsAdapter('key-1', impl).travelTimes(agents(3), PICKUP);
      expect(times).toEqual([
        { distanceMeters: 900, durationSeconds: 180 },
        { distanceMeters: 2_400, durationSeconds: 420 },
        null,
      ]);
      expect(calls[0]!.url).toBe('https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix');
      const headers = calls[0]!.init.headers as Record<string, string>;
      expect(headers['x-goog-api-key']).toBe('key-1');
      expect(headers['x-goog-fieldmask']).toBe('originIndex,destinationIndex,condition,distanceMeters,duration');
      const body = JSON.parse(String(calls[0]!.init.body));
      expect(body).toMatchObject({ travelMode: 'DRIVE', routingPreference: 'TRAFFIC_AWARE' });
      expect(body.origins).toHaveLength(3);
      expect(body.destinations).toEqual([
        { waypoint: { location: { latLng: { latitude: 6.4474, longitude: 3.4723 } } } },
      ]);
    });

    it('takes a route Google sends without a distance or time as none, as it leaves zeros out', async () => {
      const { impl } = fakeFetch(() =>
        Response.json([
          { condition: 'ROUTE_EXISTS' },
          { originIndex: 1, destinationIndex: 0, condition: 'ROUTE_EXISTS', duration: '30s' },
        ]),
      );
      expect(await new GoogleMapsAdapter('key-1', impl).travelTimes(agents(2), PICKUP)).toEqual([
        { distanceMeters: 0, durationSeconds: 0 },
        { distanceMeters: 0, durationSeconds: 30 },
      ]);
    });

    it('asks in parts of at most 100 agents at a time', async () => {
      const { impl, calls } = fakeFetch((call) => {
        const origins = JSON.parse(String(call.init.body)).origins as unknown[];
        return Response.json(
          origins.map((_, i) => ({ originIndex: i, destinationIndex: 0, distanceMeters: 1_000, duration: '60s' })),
        );
      });
      const times = await new GoogleMapsAdapter('key-1', impl).travelTimes(agents(150), PICKUP);
      expect(calls).toHaveLength(2);
      expect(times).toHaveLength(150);
      expect(times.every((t) => t?.durationSeconds === 60)).toBe(true);
    });

    it('fails when Google does, saying why, so the caller can estimate instead', async () => {
      const refused = fakeFetch(() => new Response('{"error":{"message":"Quota exceeded"}}', { status: 429 }));
      await expect(new GoogleMapsAdapter('key-1', refused.impl).travelTimes(agents(2), PICKUP)).rejects.toThrow(
        'Google answered 429: Quota exceeded',
      );
      const garbled = fakeFetch(() => new Response('<html>', { status: 200 }));
      await expect(new GoogleMapsAdapter('key-1', garbled.impl).travelTimes(agents(2), PICKUP)).rejects.toThrow();
    });
  });

  describe('Mapbox', () => {
    const TOKEN = 'pk.test-token-1';

    it("asks Mapbox's Matrix with live traffic, longitude first, every agent to the pickup", async () => {
      const { impl, calls } = fakeFetch(() =>
        Response.json({ code: 'Ok', durations: [[180.4], [419.6], [null]], distances: [[900.2], [2_400], [null]] }),
      );
      const times = await new MapboxMapsAdapter(TOKEN, impl).travelTimes(agents(3), PICKUP);
      expect(times).toEqual([
        { distanceMeters: 900, durationSeconds: 180 },
        { distanceMeters: 2_400, durationSeconds: 420 },
        null,
      ]);
      const url = new URL(calls[0]!.url);
      expect(url.pathname).toBe(
        '/directions-matrix/v1/mapbox/driving-traffic/3.46,6.44;3.461,6.441;3.462,6.442;3.4723,6.4474',
      );
      expect(Object.fromEntries(url.searchParams)).toMatchObject({
        sources: '0;1;2',
        destinations: '3',
        annotations: 'duration,distance',
        access_token: TOKEN,
      });
    });

    it('asks in parts of at most 9 agents, as live traffic takes 10 points with the pickup', async () => {
      const { impl, calls } = fakeFetch((call) => {
        const n = new URL(call.url).searchParams.get('sources')!.split(';').length;
        return Response.json({
          code: 'Ok',
          durations: Array.from({ length: n }, () => [60]),
          distances: Array.from({ length: n }, () => [1_000]),
        });
      });
      const times = await new MapboxMapsAdapter(TOKEN, impl).travelTimes(agents(12), PICKUP);
      expect(calls).toHaveLength(2);
      expect(new URL(calls[1]!.url).searchParams.get('sources')).toBe('0;1;2');
      expect(times).toHaveLength(12);
      expect(times.every((t) => t?.durationSeconds === 60)).toBe(true);
    });

    it('fails when Mapbox does, saying why without the token', async () => {
      const refused = fakeFetch(() => new Response('{"message":"Too Many Requests"}', { status: 429 }));
      const error = await new MapboxMapsAdapter(TOKEN, refused.impl).travelTimes(agents(2), PICKUP).catch((e) => e);
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe('Mapbox answered 429: Too Many Requests');
      expect(String(error.message)).not.toContain(TOKEN);
      const noRoute = fakeFetch(() => Response.json({ code: 'NoRoute' }));
      await expect(new MapboxMapsAdapter(TOKEN, noRoute.impl).travelTimes(agents(2), PICKUP)).rejects.toThrow();
    });
  });

  it('asks nothing for no agents', async () => {
    const { impl, calls } = fakeFetch(() => Response.json([]));
    expect(await new GoogleMapsAdapter('key-1', impl).travelTimes([], PICKUP)).toEqual([]);
    expect(await new MapboxMapsAdapter('pk.x', impl).travelTimes([], PICKUP)).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('estimates from straight lines in development', async () => {
    const [near, far] = await new FakeMapsAdapter().travelTimes(
      [
        { lat: 6.4484, lng: 3.4723 },
        { lat: 6.4674, lng: 3.4723 },
      ],
      PICKUP,
    );
    expect(near!.durationSeconds).toBeLessThan(far!.durationSeconds);
    expect(far!.distanceMeters).toBeGreaterThan(2_000);
  });
});
