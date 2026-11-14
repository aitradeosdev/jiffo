import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { ZodBody } from '../common/zod-body';
import { AdminAuthService } from './admin-auth.service';
import { AdminGuard, clientOf, Confirmed, CurrentAdmin, Needs, OpenWithoutPasskey } from './admin.guard';
import { PasskeysService } from './passkeys.service';
import { OverviewService } from './overview.service';
import type { AdminContext, AdminRequest } from './admin.types';

const InviteBody = z.object({ token: z.string().min(20).max(200) });
const AcceptBody = z.object({ token: z.string().min(20).max(200), password: z.string().min(1).max(200) });
const SignInBody = z.object({ email: z.string().email().max(200), password: z.string().min(1).max(200) });
const ChallengeBody = z.object({ challenge: z.string().min(20).max(2000) });
const CodeBody = ChallengeBody.extend({ code: z.string().min(6).max(10) });
const b64 = z.string().min(1).max(20_000);
/** A passkey answer from the browser, as @simplewebauthn/browser gives it. Extra fields browsers add are kept. */
const Credential = <T extends z.ZodRawShape>(response: T) =>
  z
    .object({
      id: z.string().min(1).max(1_000),
      rawId: z.string().min(1).max(1_000),
      type: z.literal('public-key'),
      response: z.object(response).passthrough(),
      clientExtensionResults: z.record(z.string(), z.unknown()).default({}),
    })
    .passthrough();
const Assertion = Credential({
  clientDataJSON: b64,
  authenticatorData: b64,
  signature: b64,
  userHandle: z.string().max(1_000).optional(),
});
const Attestation = Credential({
  clientDataJSON: b64,
  attestationObject: b64,
  transports: z.array(z.string().max(20)).max(10).optional(),
});
const PasskeyBody = ChallengeBody.extend({ response: Assertion });
const AddPasskeyBody = z.object({ response: Attestation, name: z.string().trim().max(60).default('') });
const ConfirmBody = z.object({ code: z.string().min(6).max(10).optional(), response: Assertion.optional() });

/** Admin sign-in. Everything else under /admin needs a session from here. */
@Controller('admin')
export class AdminAuthController {
  constructor(
    private readonly auth: AdminAuthService,
    private readonly overview: OverviewService,
    private readonly passkeyService: PasskeysService,
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

  /** Step two for an admin with a passkey: what the browser needs to ask for it. */
  @Post('auth/passkey/options')
  @HttpCode(200)
  passkeyOptions(@Body(new ZodBody(ChallengeBody)) body: z.infer<typeof ChallengeBody>) {
    return this.auth.passkeyOptions(body.challenge);
  }

  @Post('auth/passkey')
  @HttpCode(200)
  passkey(@Req() req: AdminRequest, @Body(new ZodBody(PasskeyBody)) body: z.infer<typeof PasskeyBody>) {
    return this.auth.verifyPasskey(body.challenge, body.response as never, clientOf(req, this.config));
  }

  /* ---------- The signed-in admin's passkeys ---------- */

  @Get('auth/passkeys')
  @UseGuards(AdminGuard)
  @Needs('read')
  @OpenWithoutPasskey()
  passkeys(@CurrentAdmin() admin: AdminContext) {
    return this.passkeyService.list(admin.adminId);
  }

  @Post('auth/passkeys/options')
  @HttpCode(200)
  @UseGuards(AdminGuard)
  @Needs('read')
  @OpenWithoutPasskey()
  passkeyRegistrationOptions(@CurrentAdmin() admin: AdminContext) {
    return this.passkeyService.registrationOptions(admin.adminId);
  }

  @Post('auth/passkeys')
  @UseGuards(AdminGuard)
  @Needs('read')
  @OpenWithoutPasskey()
  addPasskey(
    @CurrentAdmin() admin: AdminContext,
    @Body(new ZodBody(AddPasskeyBody)) body: z.infer<typeof AddPasskeyBody>,
  ) {
    return this.passkeyService.register(admin.adminId, body.response as never, body.name);
  }

  @Delete('auth/passkeys/:id')
  @UseGuards(AdminGuard)
  @Needs('read')
  @Confirmed()
  removePasskey(@CurrentAdmin() admin: AdminContext, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.passkeyService.remove(admin.adminId, admin.role, id);
  }

  /* ---------- Confirming it's them, before money actions ---------- */

  @Post('auth/confirm/start')
  @HttpCode(200)
  @UseGuards(AdminGuard)
  @Needs('read')
  confirmStart(@CurrentAdmin() admin: AdminContext) {
    return this.auth.confirmStart(admin);
  }

  @Post('auth/confirm')
  @HttpCode(200)
  @UseGuards(AdminGuard)
  @Needs('read')
  confirm(
    @CurrentAdmin() admin: AdminContext,
    @Req() req: AdminRequest,
    @Body(new ZodBody(ConfirmBody)) body: z.infer<typeof ConfirmBody>,
  ) {
    return this.auth.confirm(admin, { code: body.code, response: body.response as never }, clientOf(req, this.config));
  }

  @Post('auth/sign-out')
  @HttpCode(204)
  @UseGuards(AdminGuard)
  @Needs('read')
  @OpenWithoutPasskey()
  async signOut(@CurrentAdmin() admin: AdminContext) {
    await this.auth.signOut(admin.sessionId);
  }

  /** Who is signed in, what they may do, and the countries they can look at. */
  @Get('me')
  @UseGuards(AdminGuard)
  @Needs('read')
  @OpenWithoutPasskey()
  async me(@CurrentAdmin() admin: AdminContext) {
    return { ...this.auth.me(admin), countries: await this.overview.countries() };
  }
}
