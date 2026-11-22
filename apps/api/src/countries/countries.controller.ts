import { Controller, Get, Inject, Param } from '@nestjs/common';
import { publicSettings } from '@jiffo/shared';
import { CALLS, type CallsAdapter } from '../adapters/calls';
import { MAPS, type MapsAdapter } from '../adapters/maps';
import { CountriesService } from './countries.service';

@Controller('config')
export class CountriesController {
  constructor(
    private readonly countries: CountriesService,
    @Inject(CALLS) private readonly calls: CallsAdapter,
    @Inject(MAPS) private readonly maps: MapsAdapter,
  ) {}

  /** Everything the apps need at start-up for one country. Public: the apps call it before sign-in. */
  @Get(':country')
  async config(@Param('country') code: string) {
    const country = await this.countries.enabledCountry(code);
    const [{ version, settings }, states, categories] = await Promise.all([
      this.countries.currentSettings(country.code),
      this.countries.enabledStates(country.code),
      this.countries.activeCategories(country.code),
    ]);
    return {
      country: {
        code: country.code,
        name: country.name,
        currency: country.currency,
        phonePrefix: country.phonePrefix,
        timezone: country.timezone,
      },
      settingsVersion: version,
      settings: publicSettings(settings),
      states,
      categories,
      /** What this server can do: the apps hide what isn't set up. */
      features: { calls: this.calls.name !== 'none' },
      /** The map to draw beside the places the maps provider finds (its own), and its public key for the apps. */
      map: { engine: this.maps.drawn.engine, key: this.maps.drawn.appKey },
    };
  }
}
