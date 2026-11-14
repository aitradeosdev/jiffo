import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { Apps, AuthGuard, CurrentAuth } from '../auth/auth.guard';
import type { AuthContext } from '../auth/auth.types';
import { ZodBody } from '../common/zod-body';
import { CustomerIdentityService } from './customer-identity.service';

const StartBody = z.object({
  idType: z.string().max(30),
  /** Sent only when the provider's own page doesn't ask for it. */
  idNumber: z.string().max(40).optional(),
  /** The customer agreed to the check with the identity provider. */
  consent: z.literal(true),
});

/** The customer's own identity check, from the customer app. */
@Controller('me/identity')
@UseGuards(AuthGuard)
@Apps('customer')
export class CustomerIdentityController {
  constructor(private readonly identity: CustomerIdentityService) {}

  @Get()
  view(@CurrentAuth() auth: AuthContext) {
    return this.identity.view(auth.userId);
  }

  @Post()
  @HttpCode(200)
  start(@CurrentAuth() auth: AuthContext, @Body(new ZodBody(StartBody)) body: z.infer<typeof StartBody>) {
    return this.identity.start(auth.userId, body, auth.sessionId);
  }

  @Post('finish')
  @HttpCode(200)
  finish(@CurrentAuth() auth: AuthContext) {
    return this.identity.finish(auth.userId);
  }
}
