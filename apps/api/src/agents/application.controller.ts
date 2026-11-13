import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request, Response } from 'express';
import { badRequest, notFound, unauthorized } from '../common/errors';
import { z } from 'zod';
import { Apps, AuthGuard, CurrentAuth } from '../auth/auth.guard';
import type { AuthContext } from '../auth/auth.types';
import { ZodBody } from '../common/zod-body';
import { AgentApplicationService } from './application.service';

const BasicsBody = z
  .object({ stateCode: z.string().trim().min(2).max(10), area: z.string().trim().min(2).max(80) })
  .partial()
  .refine((b) => Object.keys(b).length > 0, 'Nothing to update');
const IdentityBody = z.object({
  /** Sent by the app only when the provider's own page doesn't ask for them. */
  nin: z.string().max(20).optional(),
  bvn: z.string().max(20).optional(),
  /** The agent agreed to the check with NIBSS and the identity provider. */
  consent: z.literal(true),
});
const AddressBody = z.object({
  address: z.string().trim().min(8).max(200),
  emergency: z.object({
    name: z.string().trim().min(2).max(80),
    phone: z
      .string()
      .trim()
      .regex(/^[+\d][\d\s]{6,18}$/, 'Enter a phone number'),
    relationship: z.string().trim().max(40).optional(),
  }),
});
const TermsBody = z.object({ accepted: z.literal(true) });

/** The agent's application, from the agent app. */
@Controller('agent/application')
@UseGuards(AuthGuard)
@Apps('agent')
export class AgentApplicationController {
  constructor(private readonly applications: AgentApplicationService) {}

  @Get()
  view(@CurrentAuth() auth: AuthContext) {
    return this.applications.view(auth.userId);
  }

  @Patch()
  basics(@CurrentAuth() auth: AuthContext, @Body(new ZodBody(BasicsBody)) body: z.infer<typeof BasicsBody>) {
    return this.applications.saveBasics(auth.userId, body);
  }

  /** Starts the provider's checks; the answer carries the token for its SDK in the app. */
  @Post('identity')
  @HttpCode(200)
  startIdentity(@CurrentAuth() auth: AuthContext, @Body(new ZodBody(IdentityBody)) body: z.infer<typeof IdentityBody>) {
    return this.applications.startIdentity(auth.userId, body);
  }

  @Post('identity/finish')
  @HttpCode(200)
  finishIdentity(@CurrentAuth() auth: AuthContext) {
    return this.applications.finishIdentity(auth.userId);
  }

  @Put('address')
  address(@CurrentAuth() auth: AuthContext, @Body(new ZodBody(AddressBody)) body: z.infer<typeof AddressBody>) {
    return this.applications.saveAddress(auth.userId, body);
  }

  @Post('terms')
  @HttpCode(200)
  terms(@CurrentAuth() auth: AuthContext, @Body(new ZodBody(TermsBody)) _body: z.infer<typeof TermsBody>) {
    return this.applications.acceptTerms(auth.userId);
  }

  @Post('submit')
  @HttpCode(200)
  submit(@CurrentAuth() auth: AuthContext) {
    return this.applications.submit(auth.userId);
  }
}

/** What identity providers reach: their signed results, and the pages their widgets run in. */
@Controller()
export class IdentityProviderController {
  constructor(private readonly applications: AgentApplicationService) {}

  @Post('webhooks/identity/:provider')
  @HttpCode(200)
  async webhook(@Param('provider') provider: string, @Req() req: RawBodyRequest<Request>) {
    if (!req.rawBody) throw badRequest('invalid_request', 'Missing body');
    const kept = await this.applications.recordWebhook(provider, req.rawBody, req.headers);
    if (!kept) throw unauthorized('invalid_signature', 'Signature does not match');
    return { received: true };
  }

  /** A provider's widget page, for a link the API signed when the check started. */
  @Get('identity/hosted/:provider')
  hosted(
    @Param('provider') provider: string,
    @Query('ref') reference: string | undefined,
    @Query('sig') signature: string | undefined,
    @Res() res: Response,
  ) {
    const page = reference && signature ? this.applications.hostedPage(provider, reference, signature) : null;
    if (!page) throw notFound('not_found', 'Not found');
    res.type('html').set('cache-control', 'no-store').send(page);
  }

  /** Where a provider's page sends the agent when they finish: back into the agent app. */
  @Get('identity/done')
  done(@Res() res: Response) {
    const app = 'jiffo-agent://identity-done';
    res
      .type('html')
      .send(
        `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="0;url=${app}"><title>Done</title></head><body style="font-family:system-ui,sans-serif;padding:24px"><p>All done. <a href="${app}">Go back to Jiffo Agent</a>.</p></body></html>`,
      );
  }
}
