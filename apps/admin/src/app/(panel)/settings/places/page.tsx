import type { Metadata } from 'next';
import { api, getCountry, getMe } from '@/lib/api';
import type { CountrySettings, MatchingOverride, PriceOverride, Prices } from '@jiffo/shared';
import type { Boundary } from '@/lib/shapes';
import type { PlacesMapInfo } from '@/lib/places-map';
import { Places, type PlaceState } from './places';

export const metadata: Metadata = { title: 'Places' };

type Saved = { version: number; data: PriceOverride };
type SavedMatching = { version: number; data: MatchingOverride };
interface Listed {
  /** The maps provider's own map, and its public key for the panel. */
  map: PlacesMapInfo;
  countryPrices: Prices | null;
  countryMatching: CountrySettings['matching'] | null;
  states: Array<
    Omit<PlaceState, 'cities'> & {
      cities: Array<{
        id: string;
        name: string;
        enabled: boolean;
        boundary: Boundary;
        prices: Saved;
        matching: SavedMatching;
        areas: Array<{
          id: string;
          name: string;
          enabled: boolean;
          boundary: Boundary;
          prices: Saved;
          matching: SavedMatching;
        }>;
      }>;
    }
  >;
}

/**
 * Where Jiffo works (docs/admin-panel.md, Places): each state's cities and areas, drawn on the maps provider's own
 * map and each switched on. Errands are taken only inside an area that is on, in a city and state that are on.
 */
export default async function PlacesPage() {
  const [me, country] = await Promise.all([getMe(), getCountry()]);
  const { states, countryPrices, countryMatching, map } = await api<Listed>(
    `/admin/service-areas?country=${country.code}`,
  );
  return (
    <Places
      states={states}
      countryPrices={countryPrices}
      countryMatching={countryMatching}
      canEdit={me.permissions.includes('settings')}
      map={map}
      countryCode={country.code}
    />
  );
}
