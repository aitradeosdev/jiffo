import { Global, Module } from '@nestjs/common';
import { CountriesController } from './countries.controller';
import { CountriesService } from './countries.service';
import { ServiceAreasService } from './service-areas';

@Global()
@Module({
  controllers: [CountriesController],
  providers: [CountriesService, ServiceAreasService],
  exports: [CountriesService, ServiceAreasService],
})
export class CountriesModule {}
