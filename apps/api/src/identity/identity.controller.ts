import { RateLimit } from '../common/rate-limit';
import { Controller, Get, HttpCode, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request, Response } from 'express';
import { badRequest, unauthorized } from '../common/errors';
import { PAGE_CSP } from '../common/security-headers';
import { IdentityChecksService } from './identity-checks.service';

/** Where each app picks up after a provider's page (their schemes, see the mobile app.config.ts). */
const DONE_URL = { customer: 'jiffo://identity-done', agent: 'jiffo-agent://identity-done' } as const;
const APP_NAME = { customer: 'Jiffo', agent: 'Jiffo Agent' } as const;
const appOf = (value: unknown): keyof typeof DONE_URL => (value === 'customer' ? 'customer' : 'agent');

/** What identity providers reach: their signed results, and the page that sends the person back to their app. */
@Controller()
export class IdentityProviderController {
  constructor(private readonly checks: IdentityChecksService) {}

  @Post('webhooks/identity/:provider')
  @RateLimit('webhook')
  @HttpCode(200)
  async webhook(@Param('provider') provider: string, @Req() req: RawBodyRequest<Request>) {
    if (!req.rawBody) throw badRequest('invalid_request', 'Missing body');
    const kept = await this.checks.recordWebhook(provider, req.rawBody, req.headers);
    if (!kept) throw unauthorized('invalid_signature', 'Signature does not match');
    return { received: true };
  }

  /** Where a provider's page sends the person when they finish: back into their app. */
  @Get('identity/done')
  done(@Query('for') which: string | undefined, @Res() res: Response) {
    const app = DONE_URL[appOf(which)];
    const name = APP_NAME[appOf(which)];
    res
      .type('html')
      .set('content-security-policy', PAGE_CSP)
      .send(
        `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="0;url=${app}"><title>Done</title></head><body style="font-family:system-ui,sans-serif;padding:24px"><p>All done. <a href="${app}">Go back to ${name}</a>.</p></body></html>`,
      );
  }
}
