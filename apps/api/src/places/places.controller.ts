import { RateLimit } from '../common/rate-limit';
import { Controller, Get, Inject, Param, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AuthGuard, CurrentAuth } from '../auth/auth.guard';
import type { AuthContext } from '../auth/auth.types';
import { ZodBody } from '../common/zod-body';
import { notFound } from '../common/errors';
import { MAPS, type MapsAdapter } from '../adapters/maps';
import { ServiceAreasService } from '../countries/service-areas';

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
@RateLimit('paid')
@UseGuards(AuthGuard)
export class PlacesController {
  constructor(
    @Inject(MAPS) private readonly maps: MapsAdapter,
    private readonly serviceAreas: ServiceAreasService,
  ) {}

  @Get('autocomplete')
  autocomplete(@CurrentAuth() auth: AuthContext, @Query(new ZodBody(SearchQuery)) q: z.infer<typeof SearchQuery>) {
    const near = q.lat !== undefined && q.lng !== undefined ? { lat: q.lat, lng: q.lng } : undefined;
    return this.maps.autocomplete({ query: q.q, near, countryCode: auth.countryCode, sessionToken: q.session });
  }

  /**
   * The place, with the state and area it is in where Jiffo works there (both null otherwise): from Jiffo's own
   * map of areas, never the provider's name for the region.
   */
  @Get(':placeId')
  async place(
    @CurrentAuth() auth: AuthContext,
    @Param('placeId') placeId: string,
    @Query(new ZodBody(DetailQuery)) q: z.infer<typeof DetailQuery>,
  ) {
    // Google's ids and Mapbox's base64 ones; the adapters encode them again for the provider's address.
    if (!/^[\w\-+/=.]{1,300}$/.test(placeId)) throw notFound('place_not_found', 'Place not found');
    const place = await this.maps.place(placeId, q.session);
    if (!place) throw notFound('place_not_found', 'Place not found');
    const { region: _, ...rest } = place;
    const [at] = await this.serviceAreas.servedAt(auth.countryCode, [place]);
    return { ...rest, stateCode: at?.stateCode ?? null, areaId: at?.areaId ?? null };
  }
}
