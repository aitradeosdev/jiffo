import { RateLimit } from '../common/rate-limit';
import { Body, Controller, Get, Put, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { Apps, AuthGuard, CurrentAuth } from '../auth/auth.guard';
import type { AuthContext, AuthedRequest } from '../auth/auth.types';
import { evidenceOf } from '../attestation/evidence';
import { ZodBody } from '../common/zod-body';
import { PresenceService } from './presence.service';

const PresenceBody = z
  .object({
    /** Left out when only the position is sent (the app in the background): online stays as it is. */
    online: z.boolean().optional(),
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
    /** The phone says the position is mocked (MB4); it then can't place the agent at a drop-off. */
    mocked: z.boolean().optional(),
    /** How far off the phone says the fix might be, in metres, and when it took it (ms), for the GPS checks (G1). */
    accuracy: z.number().min(0).max(1_000_000).optional(),
    fixedAt: z.number().int().positive().optional(),
    /**
     * Sent by the Go online button: the agent chose to go online now. An agent Jiffo took offline for missed
     * offers comes back online only so (docs/matching.md, M6), not by the app still reporting online.
     */
    tapped: z.boolean().optional(),
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
  @RateLimit('presence')
  report(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodBody(PresenceBody)) body: z.infer<typeof PresenceBody>,
    @Req() req: AuthedRequest & { rawBody?: Buffer },
  ) {
    return this.presence.report(auth, body, evidenceOf(req));
  }
}
