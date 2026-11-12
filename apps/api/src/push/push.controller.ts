import { Body, Controller, HttpCode, Put, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AuthGuard, CurrentAuth } from '../auth/auth.guard';
import type { AuthContext } from '../auth/auth.types';
import { ZodBody } from '../common/zod-body';
import { PushService } from './push.service';

const PushTokenBody = z.object({ token: z.string().min(10).max(4096).nullable() });

@Controller('devices/current')
@UseGuards(AuthGuard)
export class PushController {
  constructor(private readonly push: PushService) {}

  /** The app sends its push token after sign-in and whenever it changes; null switches push off. */
  @Put('push-token')
  @HttpCode(204)
  async setToken(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodBody(PushTokenBody)) body: z.infer<typeof PushTokenBody>,
  ) {
    await this.push.setToken(auth.deviceId, body.token);
  }
}
