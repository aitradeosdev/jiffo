import { Body, Controller, Delete, Get, Put, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { Apps, AuthGuard, CurrentAuth } from '../auth/auth.guard';
import type { AuthContext } from '../auth/auth.types';
import { RateLimit } from '../common/rate-limit';
import { ZodBody } from '../common/zod-body';
import { DestinationService } from './destination.service';

const DestinationBody = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  /** How the app names it, such as Home, or the place picked. */
  label: z.string().trim().min(1).max(80),
});

/** Where the agent is heading, such as home (destination mode, docs/matching.md, M13). */
@Controller('agent/destination')
@UseGuards(AuthGuard)
@Apps('agent')
@RateLimit('presence')
export class DestinationController {
  constructor(private readonly destinations: DestinationService) {}

  @Get()
  get(@CurrentAuth() auth: AuthContext) {
    return this.destinations.status(auth);
  }

  @Put()
  set(@CurrentAuth() auth: AuthContext, @Body(new ZodBody(DestinationBody)) body: z.infer<typeof DestinationBody>) {
    return this.destinations.set(auth, body);
  }

  @Delete()
  clear(@CurrentAuth() auth: AuthContext) {
    return this.destinations.clear(auth);
  }
}
