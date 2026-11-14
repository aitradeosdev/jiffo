import { Body, Controller, Get, HttpCode, HttpException, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { badRequest, notFound, unauthorized } from '../common/errors';
import { ZodBody } from '../common/zod-body';
import { referenceRole } from '../adapters/identity';
import { HostedPageFailure, IdentityChecksService } from './identity-checks.service';

/** Where each app picks up after a provider's page (their schemes, see the mobile app.config.ts). */
const DONE_URL = { customer: 'jiffo://identity-done', agent: 'jiffo-agent://identity-done' } as const;
const APP_NAME = { customer: 'Jiffo', agent: 'Jiffo Agent' } as const;
const appOf = (value: unknown): keyof typeof DONE_URL => (value === 'customer' ? 'customer' : 'agent');
const forReference = (reference: string | undefined) => referenceRole(reference);
/** The cookie that keeps a check's page to the browser it was first opened in. */
const BINDING_COOKIE = 'jiffo_check';
const cookieOf = (req: Request) =>
  (req.headers.cookie ?? '')
    .split(';')
    .map((c) => c.trim().split('='))
    .find(([name]) => name === BINDING_COOKIE)?.[1];

/** From a provider's page that Jiffo serves: the signed link it was opened with, the numbers and the session. */
const PageBody = z
  .object({
    ref: z.string().min(1).max(100),
    sig: z.string().min(1).max(100),
    idNumber: z.string().max(40).optional(),
    /** Pages served before ID types send the NIN under this name. */
    nin: z.string().max(40).optional(),
    bvn: z.string().max(20).optional(),
    session: z.string().max(200).optional(),
    sessionSig: z.string().max(100).optional(),
  })
  .transform(({ nin, idNumber, ...rest }) => ({ ...rest, idNumber: idNumber ?? nin ?? '' }));

/** What identity providers reach: their signed results, and the pages their widgets run in. */
@Controller()
export class IdentityProviderController {
  constructor(private readonly checks: IdentityChecksService) {}

  @Post('webhooks/identity/:provider')
  @HttpCode(200)
  async webhook(@Param('provider') provider: string, @Req() req: RawBodyRequest<Request>) {
    if (!req.rawBody) throw badRequest('invalid_request', 'Missing body');
    const kept = await this.checks.recordWebhook(provider, req.rawBody, req.headers);
    if (!kept) throw unauthorized('invalid_signature', 'Signature does not match');
    return { received: true };
  }

  /** A provider's widget page, for a link the API signed when the check started. */
  @Get('identity/hosted/:provider')
  async hosted(
    @Param('provider') provider: string,
    @Query('ref') reference: string | undefined,
    @Query('exp') expires: string | undefined,
    @Query('sig') signature: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    let page: Awaited<ReturnType<IdentityProviderController['checks']['hostedPage']>>;
    const keep = (binding: string | undefined) => {
      if (!binding) return;
      res.cookie(BINDING_COOKIE, binding, {
        httpOnly: true,
        secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
        sameSite: 'lax',
        path: '/v1/identity/hosted',
        maxAge: 24 * 3_600_000,
      });
    };
    try {
      page =
        reference && expires && signature
          ? await this.checks.hostedPage(provider, { reference, expires, signature }, cookieOf(req))
          : null;
    } catch (thrown) {
      // A failed open that bound the link still gives this browser the cookie, so it can try again.
      let error: unknown = thrown;
      if (thrown instanceof HostedPageFailure) {
        keep(thrown.binding);
        error = thrown.error;
      }
      if (error instanceof HttpException && error.getStatus() === 410) {
        res
          .status(410)
          .type('html')
          .set('cache-control', 'no-store')
          .send(
            `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Opened elsewhere</title></head><body style="font-family:system-ui,sans-serif;padding:24px"><h1 style="font-size:24px">This link was opened on another device</h1><p>It works only where it was first opened. Start the check again from the app.</p></body></html>`,
          );
        return;
      }
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
    if (page === 'expired') {
      res
        .status(410)
        .type('html')
        .set('cache-control', 'no-store')
        .send(
          `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Link expired</title></head><body style="font-family:system-ui,sans-serif;padding:24px"><h1 style="font-size:24px">This link has expired</h1><p>Start the check again from the app.</p><p><a href="${DONE_URL[forReference(reference)]}">Go back to ${APP_NAME[forReference(reference)]}</a></p></body></html>`,
        );
      return;
    }
    if (page === 'finished') {
      res
        .status(410)
        .type('html')
        .set('cache-control', 'no-store')
        .send(
          `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Finished</title></head><body style="font-family:system-ui,sans-serif;padding:24px"><h1 style="font-size:24px">This check is finished</h1><p>It is done, or was started again. Go back to the app.</p><p><a href="${DONE_URL[forReference(reference)]}">Go back to ${APP_NAME[forReference(reference)]}</a></p></body></html>`,
        );
      return;
    }
    keep(page.binding);
    res.type('html').set('cache-control', 'no-store').send(page.html);
  }

  /** What the person entered on a provider's page that Jiffo serves, sent from that page. */
  @Post('identity/hosted/:provider/submit')
  @HttpCode(200)
  async submitPage(
    @Param('provider') provider: string,
    @Body(new ZodBody(PageBody)) body: z.infer<typeof PageBody>,
    @Req() req: Request,
  ) {
    const result = await this.checks.submitPage(provider, body, cookieOf(req));
    if (!result) throw notFound('not_found', 'Not found');
    return result;
  }

  /** Where a provider's page sends the person when they finish: back into their app. */
  @Get('identity/done')
  done(@Query('for') which: string | undefined, @Res() res: Response) {
    const app = DONE_URL[appOf(which)];
    const name = APP_NAME[appOf(which)];
    res
      .type('html')
      .send(
        `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="0;url=${app}"><title>Done</title></head><body style="font-family:system-ui,sans-serif;padding:24px"><p>All done. <a href="${app}">Go back to ${name}</a>.</p></body></html>`,
      );
  }
}
