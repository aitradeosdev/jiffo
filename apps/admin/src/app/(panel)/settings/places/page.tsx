import type { Metadata } from 'next';
import { api, getCountry, getMe } from '@/lib/api';
import type { Boundary } from '@/lib/shapes';
import { Places, type PlaceState } from './places';

export const metadata: Metadata = { title: 'Places' };

interface Listed {
  states: Array<
    Omit<PlaceState, 'cities'> & {
      cities: Array<{
        id: string;
        name: string;
        enabled: boolean;
        boundary: Boundary;
        areas: Array<{ id: string; name: string; enabled: boolean; boundary: Boundary }>;
      }>;
    }
  >;
}

/**
 * Where Jiffo works (docs/admin-panel.md, Places): each state's cities and areas, drawn on Google's map and each
 * switched on. Errands are taken only inside an area that is on, in a city and state that are on.
 */
export default async function PlacesPage() {
  const [me, country] = await Promise.all([getMe(), getCountry()]);
  const { states } = await api<Listed>(`/admin/service-areas?country=${country.code}`);
  return (
    <Places
      states={states}
      canEdit={me.permissions.includes('settings')}
      mapsKey={process.env.GOOGLE_MAPS_BROWSER_KEY ?? ''}
    />
  );
}
