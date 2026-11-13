import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
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
/** From a provider's page that Jiffo serves: the signed link it was opened with, the NIN and the session. */
const PageBody = z.object({
  ref: z.string().min(1).max(100),
  sig: z.string().min(1).max(100),
  nin: z.string().max(20),
  session: z.string().max(200).optional(),
  sessionSig: z.string().max(100).optional(),
});

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

/** Where the agent app picks up after a provider's page (its scheme, see app.config.ts). */
const IDENTITY_DONE_APP_URL = 'jiffo-agent://identity-done';

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
  async hosted(
    @Param('provider') provider: string,
    @Query('ref') reference: string | undefined,
    @Query('sig') signature: string | undefined,
    @Res() res: Response,
  ) {
    let page: string | null;
    try {
      page = reference && signature ? await this.applications.hostedPage(provider, reference, signature) : null;
    } catch (error) {
      // The provider couldn't start the check, or the page was opened too often: said in the browser.
      if (!(error instanceof HttpException) || ![429, 503].includes(error.getStatus())) throw error;
      const later = error.getStatus() === 429;
      res
        .status(error.getStatus())
        .type('html')
        .set('cache-control', 'no-store')
        .send(
          `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Try again</title></head><body style="font-family:system-ui,sans-serif;padding:24px"><h1 style="font-size:24px">The check couldn't start</h1><p>${later ? 'This page was opened too many times. Try again in an hour.' : 'Try again in a moment.'}</p>${later ? '' : '<p><a href="javascript:location.reload()">Try again</a></p>'}</body></html>`,
        );
      return;
    }
    if (!page) throw notFound('not_found', 'Not found');
    if (page === 'finished') {
      res
        .status(410)
        .type('html')
        .set('cache-control', 'no-store')
        .send(
          `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Finished</title></head><body style="font-family:system-ui,sans-serif;padding:24px"><h1 style="font-size:24px">This check is finished</h1><p>It is done, or was started again. Go back to the app.</p><p><a href="${IDENTITY_DONE_APP_URL}">Go back to Jiffo Agent</a></p></body></html>`,
        );
      return;
    }
    res.type('html').set('cache-control', 'no-store').send(page);
  }

  /** What the agent entered on a provider's page that Jiffo serves, sent from that page. */
  @Post('identity/hosted/:provider/submit')
  @HttpCode(200)
  async submitPage(@Param('provider') provider: string, @Body(new ZodBody(PageBody)) body: z.infer<typeof PageBody>) {
    const result = await this.applications.submitPage(provider, body);
    if (!result) throw notFound('not_found', 'Not found');
    return result;
  }

  /** Where a provider's page sends the agent when they finish: back into the agent app. */
  @Get('identity/done')
  done(@Res() res: Response) {
    const app = IDENTITY_DONE_APP_URL;
    res
      .type('html')
      .send(
        `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="0;url=${app}"><title>Done</title></head><body style="font-family:system-ui,sans-serif;padding:24px"><p>All done. <a href="${app}">Go back to Jiffo Agent</a>.</p></body></html>`,
      );
  }
}
