import { randomUUID } from 'node:crypto';
import { providerFetch } from './provider-fetch';
import { unavailable } from '../common/errors';

export interface PlaceSuggestion {
  placeId: string;
  title: string;
  subtitle: string;
}

export interface Place {
  placeId: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  /** The first-level region (a Nigerian state), as the provider names it. */
  region: string | null;
}

export interface LatLng {
  lat: number;
  lng: number;
}

export interface RouteEstimate {
  distanceMeters: number;
  durationSeconds: number;
}

/**
 * Address search, place details and route distance: Google Maps or Mapbox, chosen in the panel (Settings,
 * Providers). Keys stay on the server: the apps only ever talk to Jiffo.
 */
export interface MapsAdapter {
  readonly name: string;
  autocomplete(input: {
    query: string;
    near?: LatLng;
    countryCode: string;
    sessionToken?: string;
  }): Promise<PlaceSuggestion[]>;
  place(placeId: string, sessionToken?: string): Promise<Place | null>;
  /** Driving distance through the points in order. */
  route(points: LatLng[]): Promise<RouteEstimate>;
  /**
   * How long each origin takes to reach one destination by road, with live traffic where the provider has it
   * (docs/matching.md, M3): agents to a pickup. null for an origin it found no route from. Fails when the
   * provider does, so the caller can estimate instead.
   */
  travelTimes(origins: LatLng[], destination: LatLng): Promise<Array<RouteEstimate | null>>;
}

/** Splits a list into parts of at most `size`. */
const inParts = <T>(items: T[], size: number) =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));

export const MAPS = Symbol('MAPS');

const EARTH_RADIUS_M = 6_371_000;
/** Straight-line distance between two points. */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/** A rough road estimate from straight lines: roads wind about 30% more, at about 20 km/h in city traffic. */
export function estimateRoute(points: LatLng[]): RouteEstimate {
  let straight = 0;
  for (let i = 1; i < points.length; i++) straight += haversineMeters(points[i - 1]!, points[i]!);
  const distanceMeters = Math.round(straight * 1.3);
  return { distanceMeters, durationSeconds: Math.round(distanceMeters / (20_000 / 3600)) };
}

/** Google Places API (New) for search and details, Routes API for distance. */
export class GoogleMapsAdapter implements MapsAdapter {
  readonly name = 'google';

  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = providerFetch,
  ) {}

  /** For the panel's Test button: one place search, with Google's own words if it is refused. */
  async check() {
    const res = await this.fetchImpl('https://places.googleapis.com/v1/places:autocomplete', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey },
      body: JSON.stringify({ input: 'Lagos', includedRegionCodes: ['ng'] }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      throw new Error(`Google answered ${res.status}: ${body?.error?.message ?? 'no details'}`);
    }
    return 'Connected. Place search works.';
  }

  /** Returns null when Google says the thing doesn't exist (an unknown or stale place id). */
  private async call<T>(
    url: string,
    init: { method: 'GET' | 'POST'; fieldMask: string; body?: unknown },
  ): Promise<T | null> {
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: init.method,
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': this.apiKey,
          'x-goog-fieldmask': init.fieldMask,
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      });
    } catch {
      throw unavailable('maps_unavailable', 'Address search is not available right now');
    }
    if (res.status === 404 || res.status === 400) return null;
    if (!res.ok) throw unavailable('maps_unavailable', 'Address search is not available right now');
    try {
      return (await res.json()) as T;
    } catch {
      throw unavailable('maps_unavailable', 'Address search is not available right now');
    }
  }

  async autocomplete(input: { query: string; near?: LatLng; countryCode: string; sessionToken?: string }) {
    const body = await this.call<{
      suggestions?: Array<{
        placePrediction?: {
          placeId: string;
          structuredFormat?: { mainText?: { text: string }; secondaryText?: { text: string } };
          text?: { text: string };
        };
      }>;
    }>('https://places.googleapis.com/v1/places:autocomplete', {
      method: 'POST',
      fieldMask:
        'suggestions.placePrediction.placeId,suggestions.placePrediction.structuredFormat,suggestions.placePrediction.text',
      body: {
        input: input.query,
        includedRegionCodes: [input.countryCode.toLowerCase()],
        sessionToken: input.sessionToken,
        ...(input.near
          ? {
              locationBias: {
                circle: { center: { latitude: input.near.lat, longitude: input.near.lng }, radius: 30_000 },
              },
            }
          : {}),
      },
    });
    return (body?.suggestions ?? [])
      .map((s) => s.placePrediction)
      .filter((p): p is NonNullable<typeof p> => !!p)
      .map((p) => ({
        placeId: p.placeId,
        title: p.structuredFormat?.mainText?.text ?? p.text?.text ?? '',
        subtitle: p.structuredFormat?.secondaryText?.text ?? '',
      }));
  }

  async place(placeId: string, sessionToken?: string) {
    const query = sessionToken ? `?sessionToken=${encodeURIComponent(sessionToken)}` : '';
    const p = await this.call<{
      id: string;
      displayName?: { text: string };
      formattedAddress?: string;
      location?: { latitude: number; longitude: number };
      addressComponents?: Array<{ longText?: string; types?: string[] }>;
    }>(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}${query}`, {
      method: 'GET',
      fieldMask: 'id,displayName,formattedAddress,location,addressComponents',
    });
    if (!p?.location) return null;
    return {
      placeId: p.id,
      name: p.displayName?.text ?? p.formattedAddress ?? '',
      address: p.formattedAddress ?? '',
      lat: p.location.latitude,
      lng: p.location.longitude,
      region: p.addressComponents?.find((c) => c.types?.includes('administrative_area_level_1'))?.longText ?? null,
    };
  }

  async route(points: LatLng[]) {
    if (points.length < 2) return { distanceMeters: 0, durationSeconds: 0 };
    const waypoint = (p: LatLng) => ({ location: { latLng: { latitude: p.lat, longitude: p.lng } } });
    try {
      const body = await this.call<{ routes?: Array<{ distanceMeters?: number; duration?: string }> }>(
        'https://routes.googleapis.com/directions/v2:computeRoutes',
        {
          method: 'POST',
          fieldMask: 'routes.distanceMeters,routes.duration',
          body: {
            origin: waypoint(points[0]!),
            destination: waypoint(points[points.length - 1]!),
            intermediates: points.slice(1, -1).map(waypoint),
            travelMode: 'DRIVE',
          },
        },
      );
      const route = body?.routes?.[0];
      if (!route?.distanceMeters) return estimateRoute(points);
      return { distanceMeters: route.distanceMeters, durationSeconds: Number.parseInt(route.duration ?? '0', 10) };
    } catch {
      // Pricing must still work if the routes service is down: fall back to the straight-line estimate.
      return estimateRoute(points);
    }
  }

  /** A Route Matrix request, whose failures say why for the log: Google's status and words, never the key. */
  private async matrix(body: unknown) {
    let res: Response;
    try {
      res = await this.fetchImpl('https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': this.apiKey,
          'x-goog-fieldmask': 'originIndex,destinationIndex,condition,distanceMeters,duration',
        },
        body: JSON.stringify(body),
      });
    } catch {
      throw new Error('Google could not be reached');
    }
    const json = (await res.json().catch(() => null)) as unknown;
    if (!res.ok) {
      const message = (json as { error?: { message?: string } } | null)?.error?.message;
      throw new Error(`Google answered ${res.status}: ${message ?? 'no details'}`);
    }
    if (!Array.isArray(json)) throw new Error('Google sent no route matrix');
    return json as Array<{
      originIndex?: number;
      condition?: string;
      status?: { code?: number };
      distanceMeters?: number;
      duration?: string;
    }>;
  }

  async travelTimes(origins: LatLng[], destination: LatLng) {
    const waypoint = (p: LatLng) => ({ waypoint: { location: { latLng: { latitude: p.lat, longitude: p.lng } } } });
    const parts = await Promise.all(
      inParts(origins, GOOGLE_MATRIX_ORIGINS).map(async (part) => {
        const elements = await this.matrix({
          origins: part.map(waypoint),
          destinations: [waypoint(destination)],
          travelMode: 'DRIVE',
          routingPreference: 'TRAFFIC_AWARE',
        });
        const times: Array<RouteEstimate | null> = part.map(() => null);
        for (const e of elements) {
          // Google leaves zeros out: no index is the first origin's, no distance or time is none at all.
          const i = e.originIndex ?? 0;
          if (i >= part.length || e.status?.code) continue;
          if (e.condition !== 'ROUTE_EXISTS' && (e.condition !== undefined || e.duration === undefined)) continue;
          times[i] = {
            distanceMeters: e.distanceMeters ?? 0,
            durationSeconds: Number.parseInt(e.duration ?? '0', 10),
          };
        }
        return times;
      }),
    );
    return parts.flat();
  }
}

/** Origins per Route Matrix request: well inside Google's limit on elements. */
const GOOGLE_MATRIX_ORIGINS = 100;

const MAPBOX = 'https://api.mapbox.com';
/** The most points Mapbox routes in one request. */
const MAPBOX_MAX_POINTS = 25;
/** The most points a Mapbox matrix with live traffic takes: the pickup and 9 agents. */
const MAPBOX_TRAFFIC_MATRIX_POINTS = 10;
/**
 * The kinds of suggestion with a position to pick: not a category ("Supermarket"), which has none, nor a whole
 * state, country or postcode, which is no errand stop.
 */
const MAPBOX_TYPES = 'poi,address,street,block,neighborhood,locality,district,place,city';
/** Suggestions that are searches of their own rather than places, which retrieve gives no position for. */
const MAPBOX_NOT_PLACES = new Set(['category', 'brand', 'query']);
/** providerFetch's own words for a redirect, which say where it pointed and never quote the address called. */
const REDIRECT = 'The provider answered with a redirect';

/**
 * Mapbox: the Search Box API for search and details (suggest, then retrieve), the Directions API for driving
 * distance. The token goes in the address, as Mapbox takes it only there, so no error here ever includes an
 * address it was sent to.
 */
export class MapboxMapsAdapter implements MapsAdapter {
  readonly name = 'mapbox';

  constructor(
    private readonly accessToken: string,
    private readonly fetchImpl: typeof fetch = providerFetch,
  ) {}

  private url(path: string, params: Record<string, string | undefined>) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (value !== undefined) query.set(key, value);
    query.set('access_token', this.accessToken);
    return `${MAPBOX}${path}?${query}`;
  }

  /** For the panel's Test button: one place search, with Mapbox's own words if it is refused. */
  async check() {
    const res = await this.fetchImpl(
      this.url('/search/searchbox/v1/suggest', { q: 'Lagos', country: 'ng', session_token: randomUUID() }),
    ).catch((error: unknown) => {
      // Any other error may quote the address called, token and all.
      if (error instanceof Error && error.message.startsWith(REDIRECT)) throw error;
      throw new Error("Mapbox couldn't be reached");
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      throw new Error(`Mapbox answered ${res.status}: ${body?.message ?? 'no details'}`);
    }
    return 'Connected. Place search works.';
  }

  /**
   * Returns null for a place Mapbox doesn't know or won't look up (an unknown or stale id), when `missing` is
   * allowed. Otherwise a refused request is unavailable, so a broken setup never looks like a search that found
   * nothing.
   */
  private async call<T>(url: string, missing = false): Promise<T | null> {
    let res: Response;
    try {
      res = await this.fetchImpl(url);
    } catch {
      // The error may quote the address, token and all: it is never passed on.
      throw unavailable('maps_unavailable', 'Address search is not available right now');
    }
    if (missing && (res.status === 404 || res.status === 400 || res.status === 422)) return null;
    if (!res.ok) throw unavailable('maps_unavailable', 'Address search is not available right now');
    try {
      return (await res.json()) as T;
    } catch {
      throw unavailable('maps_unavailable', 'Address search is not available right now');
    }
  }

  async autocomplete(input: { query: string; near?: LatLng; countryCode: string; sessionToken?: string }) {
    const body = await this.call<{
      suggestions?: Array<{
        name?: string;
        mapbox_id?: string;
        feature_type?: string;
        place_formatted?: string;
        full_address?: string;
      }>;
    }>(
      this.url('/search/searchbox/v1/suggest', {
        q: input.query.slice(0, 256),
        country: input.countryCode.toLowerCase(),
        // Mapbox needs one, and bills a search and its pick as one session when they share it.
        session_token: input.sessionToken ?? randomUUID(),
        proximity: input.near ? `${input.near.lng},${input.near.lat}` : undefined,
        types: MAPBOX_TYPES,
        limit: '8',
        language: 'en',
      }),
    );
    return (body?.suggestions ?? [])
      .filter((s) => !!s.mapbox_id && !MAPBOX_NOT_PLACES.has(s.feature_type ?? ''))
      .map((s) => ({
        placeId: s.mapbox_id!,
        title: s.name ?? s.full_address ?? '',
        subtitle: s.place_formatted ?? s.full_address ?? '',
      }));
  }

  async place(placeId: string, sessionToken?: string) {
    const body = await this.call<{
      features?: Array<{
        geometry?: { coordinates?: [number, number] };
        properties?: {
          name?: string;
          mapbox_id?: string;
          feature_type?: string;
          full_address?: string;
          place_formatted?: string;
          context?: { region?: { name?: string } };
        };
      }>;
    }>(
      this.url(`/search/searchbox/v1/retrieve/${encodeURIComponent(placeId)}`, {
        session_token: sessionToken ?? randomUUID(),
        language: 'en',
      }),
      true,
    );
    const feature = body?.features?.[0];
    const [lng, lat] = feature?.geometry?.coordinates ?? [];
    if (typeof lat !== 'number' || typeof lng !== 'number') return null;
    const p = feature?.properties ?? {};
    const address = p.full_address ?? p.place_formatted ?? '';
    return {
      placeId: p.mapbox_id ?? placeId,
      name: p.name ?? address,
      address,
      lat,
      lng,
      // A state picked as itself names itself; anything in one names it in its context.
      region: (p.feature_type === 'region' ? p.name : p.context?.region?.name) ?? null,
    };
  }

  async route(points: LatLng[]) {
    if (points.length < 2) return { distanceMeters: 0, durationSeconds: 0 };
    if (points.length > MAPBOX_MAX_POINTS) return estimateRoute(points);
    // Longitude first, to 6 decimals (about 10 cm), which keeps the address short.
    const coord = (n: number) => String(Number(n.toFixed(6)));
    const path = points.map((p) => `${coord(p.lng)},${coord(p.lat)}`).join(';');
    try {
      const body = await this.call<{ code?: string; routes?: Array<{ distance?: number; duration?: number }> }>(
        this.url(`/directions/v5/mapbox/driving/${path}`, { overview: 'false', steps: 'false' }),
      );
      const route = body?.code === 'Ok' ? body.routes?.[0] : undefined;
      if (!route?.distance) return estimateRoute(points);
      return { distanceMeters: Math.round(route.distance), durationSeconds: Math.round(route.duration ?? 0) };
    } catch {
      // Pricing must still work if the routes service is down: fall back to the straight-line estimate.
      return estimateRoute(points);
    }
  }

  /**
   * A Matrix request, whose failures say why for the log: Mapbox's status and words. Never the address it was
   * sent to, which holds the token.
   */
  private async matrix(url: string) {
    let res: Response;
    try {
      res = await this.fetchImpl(url);
    } catch {
      throw new Error('Mapbox could not be reached');
    }
    const json = (await res.json().catch(() => null)) as {
      code?: string;
      message?: string;
      durations?: Array<Array<number | null>>;
      distances?: Array<Array<number | null>>;
    } | null;
    if (!res.ok) throw new Error(`Mapbox answered ${res.status}: ${json?.message ?? json?.code ?? 'no details'}`);
    if (json?.code !== 'Ok' || !json.durations) {
      throw new Error(`Mapbox sent no matrix${json?.code ? ` (${json.code})` : ''}`);
    }
    return json;
  }

  async travelTimes(origins: LatLng[], destination: LatLng) {
    const coord = (p: LatLng) => `${Number(p.lng.toFixed(6))},${Number(p.lat.toFixed(6))}`;
    const parts = await Promise.all(
      inParts(origins, MAPBOX_TRAFFIC_MATRIX_POINTS - 1).map(async (part) => {
        const path = [...part, destination].map(coord).join(';');
        const body = await this.matrix(
          this.url(`/directions-matrix/v1/mapbox/driving-traffic/${path}`, {
            sources: part.map((_, i) => i).join(';'),
            destinations: String(part.length),
            annotations: 'duration,distance',
          }),
        );
        return part.map((_, i): RouteEstimate | null => {
          const duration = body.durations?.[i]?.[0];
          const distance = body.distances?.[i]?.[0];
          if (duration === null || duration === undefined || distance === null || distance === undefined) return null;
          return { distanceMeters: Math.round(distance), durationSeconds: Math.round(duration) };
        });
      }),
    );
    return parts.flat();
  }
}

/** Development and tests: a handful of real Lagos places, matched by name. */
export const FAKE_PLACES: Place[] = [
  {
    placeId: 'fake-shoprite-lekki',
    name: 'Shoprite',
    address: 'Lekki–Epe Expressway, Lekki, Lagos',
    lat: 6.4442,
    lng: 3.4761,
    region: 'Lagos',
  },
  {
    placeId: 'fake-medplus-admiralty',
    name: 'Medplus Pharmacy',
    address: 'Admiralty Way, Lekki Phase 1, Lagos',
    lat: 6.4474,
    lng: 3.4723,
    region: 'Lagos',
  },
  {
    placeId: 'fake-circle-mall',
    name: 'Circle Mall',
    address: 'Lekki–Epe Expressway, Osapa, Lagos',
    lat: 6.4386,
    lng: 3.5235,
    region: 'Lagos',
  },
  {
    placeId: 'fake-admiralty-12',
    name: '12 Admiralty Way',
    address: 'Lekki Phase 1, Lagos',
    lat: 6.4491,
    lng: 3.4705,
    region: 'Lagos',
  },
  {
    placeId: 'fake-adeola-odeku',
    name: 'Adeola Odeku Street',
    address: 'Victoria Island, Lagos',
    lat: 6.4311,
    lng: 3.4158,
    region: 'Lagos',
  },
  {
    placeId: 'fake-ikeja-city-mall',
    name: 'Ikeja City Mall',
    address: 'Obafemi Awolowo Way, Alausa, Ikeja',
    lat: 6.6143,
    lng: 3.358,
    region: 'Lagos',
  },
  {
    placeId: 'fake-allen-avenue',
    name: 'Allen Avenue',
    address: 'Ikeja, Lagos',
    lat: 6.6018,
    lng: 3.3515,
    region: 'Lagos',
  },
];

export class FakeMapsAdapter implements MapsAdapter {
  readonly name = 'fake';

  async autocomplete(input: { query: string }) {
    const q = input.query.trim().toLowerCase();
    return FAKE_PLACES.filter((p) => `${p.name} ${p.address}`.toLowerCase().includes(q)).map((p) => ({
      placeId: p.placeId,
      title: p.name,
      subtitle: p.address,
    }));
  }

  async place(placeId: string) {
    return FAKE_PLACES.find((p) => p.placeId === placeId) ?? null;
  }

  async route(points: LatLng[]) {
    return estimateRoute(points);
  }

  async travelTimes(origins: LatLng[], destination: LatLng) {
    return origins.map((o) => estimateRoute([o, destination]));
  }
}
