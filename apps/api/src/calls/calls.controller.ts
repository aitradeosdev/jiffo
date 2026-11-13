import { Body, Controller, HttpCode, Param, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard, CurrentAuth } from '../auth/auth.guard';
import type { AuthContext } from '../auth/auth.types';
import { ErrandId } from '../common/params';
import { CallsService } from './calls.service';

@Controller('errands/:id/call')
@UseGuards(AuthGuard)
export class CallsController {
  constructor(private readonly calls: CallsService) {}

  /** Rings the caller's phone, then connects them to the other side of the errand. */
  @Post()
  @HttpCode(200)
  call(@CurrentAuth() auth: AuthContext, @Param('id', ErrandId) id: string) {
    return this.calls.call(id, auth);
  }
}

/** Calls providers asking what to do with a call they placed for Jiffo. */
@Controller('webhooks/calls')
export class CallsWebhookController {
  constructor(private readonly calls: CallsService) {}

  @Post(':provider/:token')
  @HttpCode(200)
  async answered(
    @Param('provider') provider: string,
    @Param('token') token: string,
    @Body() body: Record<string, string | undefined>,
    @Res() res: Response,
  ) {
    const reply = await this.calls.answered(provider, token, body ?? {});
    res.type(reply.contentType).send(reply.body);
  }
}
