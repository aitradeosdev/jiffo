import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { Apps, AuthGuard, CurrentAuth } from '../auth/auth.guard';
import type { AuthContext } from '../auth/auth.types';
import { notFound } from '../common/errors';
import { OffersService } from './offers.service';

const OfferId = new ParseUUIDPipe({ exceptionFactory: () => notFound('offer_not_found', 'This offer has ended') });

/** The agent's offers (docs/matching.md, M6). Accepting one is the errand's own accept. */
@Controller('agent/offers')
@UseGuards(AuthGuard)
@Apps('agent')
export class OffersController {
  constructor(private readonly offers: OffersService) {}

  /** The offer waiting for this agent now, for the offer screen: `offer` is null with none. */
  @Get('current')
  async current(@CurrentAuth() auth: AuthContext) {
    return { offer: await this.offers.current(auth.userId) };
  }

  @Post(':id/decline')
  @HttpCode(200)
  decline(@CurrentAuth() auth: AuthContext, @Param('id', OfferId) id: string) {
    return this.offers.decline(auth.userId, id);
  }
}
