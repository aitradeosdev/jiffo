import { Body, Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { APPS } from '../db/schema';
import { unauthorized } from '../common/errors';
import { ZodBody } from '../common/zod-body';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { AuthService, RefreshReused } from './auth.service';
import { AuthGuard, CurrentAuth } from './auth.guard';
import type { AuthContext, AuthedRequest } from './auth.types';

const Phone = z.string().trim().min(5).max(20);

const RequestCodeBody = z.object({
  phone: Phone,
  /** The app's own key for this phone, so codes are limited per phone as well as per number. */
  deviceKey: z.string().trim().min(8).max(100).optional(),
});
const VerifyCodeBody = z.object({
  phone: Phone,
  code: z.string().regex(/^\d{6}$/, 'The code is 6 digits'),
  app: z.enum(APPS),
  device: z.object({
    key: z.string().min(8).max(128),
    platform: z.enum(['ios', 'android', 'web']),
    name: z.string().max(80).optional(),
  }),
});
const RefreshBody = z.object({ refreshToken: z.string().min(20).max(200) });

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly realtime: RealtimeGateway,
  ) {}

  @Post('otp/request')
  @HttpCode(200)
  request(@Body(new ZodBody(RequestCodeBody)) body: z.infer<typeof RequestCodeBody>, @Req() req: AuthedRequest) {
    return this.auth.requestCode(body.phone, req.ip ?? null, body.deviceKey ?? null);
  }

  @Post('otp/verify')
  @HttpCode(200)
  async verify(@Body(new ZodBody(VerifyCodeBody)) body: z.infer<typeof VerifyCodeBody>) {
    const { response, replacedSessionIds, signedOutDevices } = await this.auth.verifyCode(
      body.phone,
      body.code,
      body.app,
      body.device,
    );
    this.realtime.disconnectSessions(replacedSessionIds);
    this.auth.tellSignedOut(signedOutDevices);
    return response;
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(@Body(new ZodBody(RefreshBody)) body: z.infer<typeof RefreshBody>) {
    try {
      return (await this.auth.refresh(body.refreshToken)).tokens;
    } catch (error) {
      // A copied refresh token ended every session of the account: their live connections end too.
      if (!(error instanceof RefreshReused)) throw error;
      this.realtime.disconnectSessions(error.ended);
      throw unauthorized('refresh_token_reused', 'This sign-in was used somewhere else. Sign in again.');
    }
  }

  @Post('logout')
  @HttpCode(204)
  @UseGuards(AuthGuard)
  async logout(@CurrentAuth() auth: AuthContext) {
    await this.auth.logout(auth);
    this.realtime.disconnectSessions([auth.sessionId]);
  }

  @Post('logout-others')
  @HttpCode(204)
  @UseGuards(AuthGuard)
  async logoutOthers(@CurrentAuth() auth: AuthContext) {
    this.realtime.disconnectSessions(await this.auth.logoutOthers(auth));
  }
}
