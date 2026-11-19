import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { Apps, AuthGuard, CurrentAuth } from '../auth/auth.guard';
import type { AuthContext } from '../auth/auth.types';
import { RateLimit } from '../common/rate-limit';
import { ZodBody } from '../common/zod-body';
import { AgentSelfieService } from './agent-selfie.service';

const StartBody = z.object({
  /** Asked for before changing the payout account (P8); otherwise the server says what it is for. */
  for: z.literal('payout_change').optional(),
});

/** The agent's selfie checks, from the agent app (docs/security-plan.md, A4, I8, P8, X4). */
@Controller('agent/selfie')
@UseGuards(AuthGuard)
@Apps('agent')
export class AgentSelfieController {
  constructor(private readonly selfie: AgentSelfieService) {}

  /** Whether going online or money actions on this phone need a selfie first, and whether one is fresh. */
  @Get()
  status(@CurrentAuth() auth: AuthContext) {
    return this.selfie.status(auth);
  }

  /** Starts a check: what the provider's SDK in the app needs to take the selfie. */
  @Post()
  @HttpCode(200)
  @RateLimit('paid')
  start(@CurrentAuth() auth: AuthContext, @Body(new ZodBody(StartBody)) body: z.infer<typeof StartBody>) {
    return this.selfie.start(auth, body.for);
  }

  /** After the SDK sent the selfie: the verdict, or pending until the provider has sent it. */
  @Post(':id/finish')
  @HttpCode(200)
  @RateLimit('paid')
  finish(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.selfie.finish(auth, id);
  }
}
