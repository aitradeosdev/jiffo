import { Controller, Get, Inject, Param, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AuthGuard, CurrentAuth } from '../auth/auth.guard';
import type { AuthContext } from '../auth/auth.types';
import { ZodBody } from '../common/zod-body';
import { notFound } from '../common/errors';
import { MAPS, type MapsAdapter } from '../adapters/maps';
import { CountriesService } from '../countries/countries.service';

const SearchQuery = z.object({
  q: z.string().trim().min(2).max(120),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  /** One per search session, so the provider bills a search and its pick as one. */
  session: z.string().max(64).optional(),
});
const DetailQuery = z.object({ session: z.string().max(64).optional() });

/** Address search for the apps. Signed-in only, so the provider key can't be used by anyone else. */
@Controller('places')
@UseGuards(AuthGuard)
export class PlacesController {
  constructor(
    @Inject(MAPS) private readonly maps: MapsAdapter,
    private readonly countries: CountriesService,
  ) {}

  @Get('autocomplete')
  autocomplete(@CurrentAuth() auth: AuthContext, @Query(new ZodBody(SearchQuery)) q: z.infer<typeof SearchQuery>) {
    const near = q.lat !== undefined && q.lng !== undefined ? { lat: q.lat, lng: q.lng } : undefined;
    return this.maps.autocomplete({ query: q.q, near, countryCode: auth.countryCode, sessionToken: q.session });
  }

  /** The place, with the state it is in when Jiffo is live there (null otherwise). */
  @Get(':placeId')
  async place(
    @CurrentAuth() auth: AuthContext,
    @Param('placeId') placeId: string,
    @Query(new ZodBody(DetailQuery)) q: z.infer<typeof DetailQuery>,
  ) {
    if (!/^[\w-]{1,300}$/.test(placeId)) throw notFound('place_not_found', 'Place not found');
    const place = await this.maps.place(placeId, q.session);
    if (!place) throw notFound('place_not_found', 'Place not found');
    const { region, ...rest } = place;
    return { ...rest, stateCode: region ? await this.stateFor(auth.countryCode, region) : null };
  }

  /** Matches the provider's region name ("Lagos", "Lagos State", "Abuja") to an enabled state. */
  private async stateFor(countryCode: string, region: string) {
    const plain = (s: string) =>
      s
        .toLowerCase()
        .replace(/\bstate\b/g, '')
        .replace(/[^a-z]/g, '');
    const wanted = plain(region);
    const states = await this.countries.enabledStates(countryCode);
    const match =
      states.find((s) => plain(s.name) === wanted) ??
      (wanted === 'abuja' ? states.find((s) => s.code === 'FC') : undefined);
    return match?.code ?? null;
  }
}
