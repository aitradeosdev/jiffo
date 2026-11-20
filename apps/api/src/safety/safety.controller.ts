import { Body, Controller, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AuthGuard, CurrentAuth } from '../auth/auth.guard';
import type { AuthContext } from '../auth/auth.types';
import { notFound } from '../common/errors';
import { RateLimit } from '../common/rate-limit';
import { ZodBody } from '../common/zod-body';
import { SafetyService } from './safety.service';

const Position = {
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy: z.number().min(0).max(1_000_000).optional(),
};
const PressBody = z
  .object({
    /** The errand the person is on, if any. */
    errandId: z.string().uuid().optional(),
    lat: Position.lat.optional(),
    lng: Position.lng.optional(),
    accuracy: Position.accuracy,
  })
  .refine((b) => (b.lat === undefined) === (b.lng === undefined), 'Send lat and lng together');
const FollowBody = z.object(Position);
const EmergencyId = new ParseUUIDPipe({
  exceptionFactory: () => notFound('emergency_not_found', 'Emergency not found'),
});

/** The apps' emergency button (docs/security-plan.md, E9). */
@Controller('safety/emergencies')
@UseGuards(AuthGuard)
export class SafetyController {
  constructor(private readonly safety: SafetyService) {}

  /** A press: the app has dialled the emergency number; this tells the safety team where the person is. */
  @Post()
  press(@CurrentAuth() auth: AuthContext, @Body(new ZodBody(PressBody)) body: z.infer<typeof PressBody>) {
    return this.safety.press(auth, body);
  }

  /** Where the person is now, for a while after the press. */
  @Post(':id/positions')
  @HttpCode(204)
  @RateLimit('presence')
  async follow(
    @CurrentAuth() auth: AuthContext,
    @Param('id', EmergencyId) id: string,
    @Body(new ZodBody(FollowBody)) body: z.infer<typeof FollowBody>,
  ) {
    await this.safety.follow(auth, id, body);
  }
}
