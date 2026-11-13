import { Global, Module } from '@nestjs/common';
import { CustomerIdentityController } from './customer-identity.controller';
import { CustomerIdentityService } from './customer-identity.service';
import { IdentityChecksService } from './identity-checks.service';
import { IdentityProviderController } from './identity.controller';

/** Identity checks for customers and agents, and what identity providers reach. */
@Global()
@Module({
  controllers: [IdentityProviderController, CustomerIdentityController],
  providers: [IdentityChecksService, CustomerIdentityService],
  exports: [IdentityChecksService, CustomerIdentityService],
})
export class IdentityModule {}
