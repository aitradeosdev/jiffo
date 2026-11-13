import { Body, Controller, Get, HttpCode, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { Apps, AuthGuard, CurrentAuth } from '../auth/auth.guard';
import type { AuthContext } from '../auth/auth.types';
import { ZodBody } from '../common/zod-body';
import { AgentApplicationService } from './application.service';

const BasicsBody = z
  .object({ stateCode: z.string().trim().min(2).max(10), area: z.string().trim().min(2).max(80) })
  .partial()
  .refine((b) => Object.keys(b).length > 0, 'Nothing to update');
const IdentityBody = z.object({
  /** The ID the agent verifies with, one of those the application offers. */
  idType: z.string().max(30).optional(),
  /** Sent by the app only when the provider's own page doesn't ask for them. */
  idNumber: z.string().max(40).optional(),
  bvn: z.string().max(20).optional(),
  /** Earlier versions of the app: the NIN, as the ID. */
  nin: z.string().max(20).optional(),
  /** The agent agreed to the check with the identity provider (and NIBSS, for a BVN). */
  consent: z.literal(true),
});
const AddressBody = z.object({
  address: z.string().trim().min(8).max(200),
  emergency: z.object({
    name: z.string().trim().min(2).max(80),
    phone: z
      .string()
      .trim()
      .regex(/^[+\d][\d\s]{6,18}$/, 'Enter a phone number'),
    relationship: z.string().trim().max(40).optional(),
  }),
});
const TermsBody = z.object({ accepted: z.literal(true) });

/** The agent's application, from the agent app. */
@Controller('agent/application')
@UseGuards(AuthGuard)
@Apps('agent')
export class AgentApplicationController {
  constructor(private readonly applications: AgentApplicationService) {}

  @Get()
  view(@CurrentAuth() auth: AuthContext) {
    return this.applications.view(auth.userId);
  }

  @Patch()
  basics(@CurrentAuth() auth: AuthContext, @Body(new ZodBody(BasicsBody)) body: z.infer<typeof BasicsBody>) {
    return this.applications.saveBasics(auth.userId, body);
  }

  /** Starts the provider's checks; the answer carries the token for its SDK in the app. */
  @Post('identity')
  @HttpCode(200)
  startIdentity(@CurrentAuth() auth: AuthContext, @Body(new ZodBody(IdentityBody)) body: z.infer<typeof IdentityBody>) {
    return this.applications.startIdentity(auth.userId, body);
  }

  @Post('identity/finish')
  @HttpCode(200)
  finishIdentity(@CurrentAuth() auth: AuthContext) {
    return this.applications.finishIdentity(auth.userId);
  }

  @Put('address')
  address(@CurrentAuth() auth: AuthContext, @Body(new ZodBody(AddressBody)) body: z.infer<typeof AddressBody>) {
    return this.applications.saveAddress(auth.userId, body);
  }

  @Post('terms')
  @HttpCode(200)
  terms(@CurrentAuth() auth: AuthContext, @Body(new ZodBody(TermsBody)) _body: z.infer<typeof TermsBody>) {
    return this.applications.acceptTerms(auth.userId);
  }

  @Post('submit')
  @HttpCode(200)
  submit(@CurrentAuth() auth: AuthContext) {
    return this.applications.submit(auth.userId);
  }
}
