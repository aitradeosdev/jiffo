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
 * Address search, place details and route distance. Google Maps at launch; another country's provider
 * is another implementation. Keys stay on the server: the apps only ever talk to Jiffo.
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
}

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
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

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
}
