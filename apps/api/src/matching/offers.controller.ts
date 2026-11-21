import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { Apps, AuthGuard, CurrentAuth } from '../auth/auth.guard';
import type { AuthContext } from '../auth/auth.types';
import { notFound } from '../common/errors';
import { OffersService } from './offers.service';
import { RankingService } from './ranking.service';

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

/** How the agent stands (docs/matching.md, M9), as the agent app shows it beside their rating. */
@Controller('agent/standing')
@UseGuards(AuthGuard)
@Apps('agent')
export class StandingController {
  constructor(private readonly ranking: RankingService) {}

  /** Acceptance rate, completion rate, errands left this week, rating, errands done, and any pause on offers. */
  @Get()
  standing(@CurrentAuth() auth: AuthContext) {
    return this.ranking.standing(auth.userId, auth.countryCode);
  }
}
