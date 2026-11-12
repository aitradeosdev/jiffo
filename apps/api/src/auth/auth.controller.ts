import { Body, Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { APPS } from '../db/schema';
import { ZodBody } from '../common/zod-body';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { AuthService } from './auth.service';
import { AuthGuard, CurrentAuth } from './auth.guard';
import type { AuthContext, AuthedRequest } from './auth.types';

const Phone = z.string().trim().min(5).max(20);

const RequestCodeBody = z.object({ phone: Phone });
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
    return this.auth.requestCode(body.phone, req.ip ?? null);
  }

  @Post('otp/verify')
  @HttpCode(200)
  verify(@Body(new ZodBody(VerifyCodeBody)) body: z.infer<typeof VerifyCodeBody>) {
    return this.auth.verifyCode(body.phone, body.code, body.app, body.device);
  }

  @Post('refresh')
  @HttpCode(200)
  refresh(@Body(new ZodBody(RefreshBody)) body: z.infer<typeof RefreshBody>) {
    return this.auth.refresh(body.refreshToken);
  }

  @Post('logout')
  @HttpCode(204)
  @UseGuards(AuthGuard)
  async logout(@CurrentAuth() auth: AuthContext) {
    await this.auth.logout(auth);
    this.realtime.disconnectWhere((s) => s.sessionId === auth.sessionId);
  }

  @Post('logout-others')
  @HttpCode(204)
  @UseGuards(AuthGuard)
  async logoutOthers(@CurrentAuth() auth: AuthContext) {
    await this.auth.logoutOthers(auth);
    this.realtime.disconnectWhere((s) => s.userId === auth.userId && s.sessionId !== auth.sessionId);
  }
}
