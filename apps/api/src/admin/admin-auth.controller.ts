import { Body, Controller, Get, HttpCode, Inject, Post, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { ZodBody } from '../common/zod-body';
import { AdminAuthService } from './admin-auth.service';
import { AdminGuard, clientOf, CurrentAdmin, Needs } from './admin.guard';
import { OverviewService } from './overview.service';
import type { AdminContext, AdminRequest } from './admin.types';

const InviteBody = z.object({ token: z.string().min(20).max(200) });
const AcceptBody = z.object({ token: z.string().min(20).max(200), password: z.string().min(1).max(200) });
const SignInBody = z.object({ email: z.string().email().max(200), password: z.string().min(1).max(200) });
const ChallengeBody = z.object({ challenge: z.string().min(20).max(2000) });
const CodeBody = ChallengeBody.extend({ code: z.string().min(6).max(10) });

/** Admin sign-in. Everything else under /admin needs a session from here. */
@Controller('admin')
export class AdminAuthController {
  constructor(
    private readonly auth: AdminAuthService,
    private readonly overview: OverviewService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** A POST, so the token travels in the body and never lands in access logs with the URL. */
  @Post('auth/invite/check')
  @HttpCode(200)
  inviteInfo(@Body(new ZodBody(InviteBody)) body: z.infer<typeof InviteBody>) {
    return this.auth.inviteInfo(body.token);
  }

  @Post('auth/invite/accept')
  @HttpCode(200)
  acceptInvite(@Body(new ZodBody(AcceptBody)) body: z.infer<typeof AcceptBody>) {
    return this.auth.acceptInvite(body.token, body.password);
  }

  @Post('auth/sign-in')
  @HttpCode(200)
  signIn(@Req() req: AdminRequest, @Body(new ZodBody(SignInBody)) body: z.infer<typeof SignInBody>) {
    return this.auth.signIn(body.email, body.password, clientOf(req, this.config));
  }

  @Post('auth/setup')
  @HttpCode(200)
  setup(@Body(new ZodBody(ChallengeBody)) body: z.infer<typeof ChallengeBody>) {
    return this.auth.startSetup(body.challenge);
  }

  @Post('auth/code')
  @HttpCode(200)
  code(@Req() req: AdminRequest, @Body(new ZodBody(CodeBody)) body: z.infer<typeof CodeBody>) {
    return this.auth.verifyCode(body.challenge, body.code, clientOf(req, this.config));
  }

  @Post('auth/sign-out')
  @HttpCode(204)
  @UseGuards(AdminGuard)
  @Needs('read')
  async signOut(@CurrentAdmin() admin: AdminContext) {
    await this.auth.signOut(admin.sessionId);
  }

  /** Who is signed in, what they may do, and the countries they can look at. */
  @Get('me')
  @UseGuards(AdminGuard)
  @Needs('read')
  async me(@CurrentAdmin() admin: AdminContext) {
    return { ...this.auth.me(admin), countries: await this.overview.countries() };
  }
}
