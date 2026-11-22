import { Global, Module } from '@nestjs/common';
import { CountriesController } from './countries.controller';
import { CountriesService } from './countries.service';
import { ServiceAreasService } from './service-areas';
import { PricesService } from './prices.service';
import { MatchingPlacesService } from './matching-places.service';

@Global()
@Module({
  controllers: [CountriesController],
  providers: [CountriesService, ServiceAreasService, PricesService, MatchingPlacesService],
  exports: [CountriesService, ServiceAreasService, PricesService, MatchingPlacesService],
})
export class CountriesModule {}
