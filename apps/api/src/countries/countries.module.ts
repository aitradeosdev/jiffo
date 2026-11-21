import { Global, Module } from '@nestjs/common';
import { CountriesController } from './countries.controller';
import { CountriesService } from './countries.service';
import { ServiceAreasService } from './service-areas';
import { PricesService } from './prices.service';

@Global()
@Module({
  controllers: [CountriesController],
  providers: [CountriesService, ServiceAreasService, PricesService],
  exports: [CountriesService, ServiceAreasService, PricesService],
})
export class CountriesModule {}
