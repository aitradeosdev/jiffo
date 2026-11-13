import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { Apps, AuthGuard, CurrentAuth } from '../auth/auth.guard';
import type { AuthContext } from '../auth/auth.types';
import { ZodBody } from '../common/zod-body';
import { PresenceService } from './presence.service';

const PresenceBody = z
  .object({
    online: z.boolean(),
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
  })
  .refine((b) => (b.lat === undefined) === (b.lng === undefined), 'Send lat and lng together');

/** The agent going online or offline, and where they are while online or on an errand. */
@Controller('agent/presence')
@UseGuards(AuthGuard)
@Apps('agent')
export class PresenceController {
  constructor(private readonly presence: PresenceService) {}

  @Get()
  get(@CurrentAuth() auth: AuthContext) {
    return this.presence.status(auth.userId);
  }

  @Put()
  report(@CurrentAuth() auth: AuthContext, @Body(new ZodBody(PresenceBody)) body: z.infer<typeof PresenceBody>) {
    return this.presence.report(auth, body);
  }
}
