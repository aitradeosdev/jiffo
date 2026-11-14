import { RateLimit } from '../common/rate-limit';
import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import type { z } from 'zod';
import { Apps, AuthGuard, CurrentAuth } from '../auth/auth.guard';
import type { AuthContext } from '../auth/auth.types';
import { ZodBody } from '../common/zod-body';
import { ErrandId } from '../common/params';
import { BoardQuery, CreateErrandBody, ErrandEventBody, ListQuery, QuoteBody } from './errand-input';
import { ErrandsService } from './errands.service';

@Controller('errands')
@UseGuards(AuthGuard)
export class ErrandsController {
  constructor(private readonly errands: ErrandsService) {}

  @Post()
  @Apps('customer')
  create(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodBody(CreateErrandBody)) body: z.infer<typeof CreateErrandBody>,
  ) {
    return this.errands.create(auth, body);
  }

  /** The suggested fee for a route, with the distance and time it is based on. */
  @Post('quote')
  @RateLimit('paid')
  @Apps('customer')
  @HttpCode(200)
  quote(@CurrentAuth() auth: AuthContext, @Body(new ZodBody(QuoteBody)) body: z.infer<typeof QuoteBody>) {
    return this.errands.quote(auth, body.stops);
  }

  @Get()
  list(@CurrentAuth() auth: AuthContext, @Query(new ZodBody(ListQuery)) q: z.infer<typeof ListQuery>) {
    return this.errands.listMine(auth, q.before, q.limit);
  }

  @Get('board')
  @RateLimit('board')
  @Apps('agent')
  board(@CurrentAuth() auth: AuthContext, @Query(new ZodBody(BoardQuery)) q: z.infer<typeof BoardQuery>) {
    return this.errands.board(auth, q);
  }

  @Get(':id')
  get(@CurrentAuth() auth: AuthContext, @Param('id', ErrandId) id: string) {
    return this.errands.get(id, auth);
  }

  @Get(':id/events')
  events(@CurrentAuth() auth: AuthContext, @Param('id', ErrandId) id: string) {
    return this.errands.events(id, auth);
  }

  @Get(':id/pin')
  @Apps('customer')
  pin(@CurrentAuth() auth: AuthContext, @Param('id', ErrandId) id: string) {
    return this.errands.pin(id, auth);
  }

  @Post(':id/events')
  @HttpCode(200)
  transition(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ErrandId) id: string,
    @Body(new ZodBody(ErrandEventBody)) body: z.infer<typeof ErrandEventBody>,
  ) {
    return this.errands.transition(id, auth, body);
  }
}
