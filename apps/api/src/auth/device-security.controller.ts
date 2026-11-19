import { Body, Controller, Get, HttpCode, Post, Put, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { ZodBody } from '../common/zod-body';
import { AuthGuard, CurrentAuth } from './auth.guard';
import type { AuthContext } from './auth.types';
import { DeviceSecurityService } from './device-security.service';
import { Signed } from './signed.guard';

const KeyBody = z.object({ publicKey: z.string().trim().min(60).max(400) });
const PinBody = z.object({ pin: z.string(), currentPin: z.string().optional() });

/** The phone's own key and the app PIN, which money actions need (docs/security-plan.md, A3, A7). */
@Controller()
@UseGuards(AuthGuard)
export class DeviceSecurityController {
  constructor(private readonly security: DeviceSecurityService) {}

  @Get('me/security')
  status(@CurrentAuth() auth: AuthContext) {
    return this.security.status(auth);
  }

  /** The public half of the key this phone made in its secure hardware; once, just after signing in. */
  @Put('devices/current/key')
  @HttpCode(204)
  async registerKey(@CurrentAuth() auth: AuthContext, @Body(new ZodBody(KeyBody)) body: z.infer<typeof KeyBody>) {
    await this.security.registerKey(auth, body.publicKey);
  }

  /** A single-use code to sign a money request over. */
  @Post('devices/current/challenge')
  @HttpCode(200)
  challenge(@CurrentAuth() auth: AuthContext) {
    return this.security.challenge(auth);
  }

  /** Sets or changes the app PIN, signed by this phone. */
  @Put('me/pin')
  @HttpCode(200)
  @Signed({ pin: false })
  setPin(@CurrentAuth() auth: AuthContext, @Body(new ZodBody(PinBody)) body: z.infer<typeof PinBody>) {
    return this.security.setPin(auth, body);
  }
}
