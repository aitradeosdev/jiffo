import { Controller, Delete, Param, Put, UseGuards } from '@nestjs/common';
import { AuthGuard, CurrentAuth } from '../auth/auth.guard';
import type { AuthContext } from '../auth/auth.types';
import { ErrandId } from '../common/params';
import { MatchBlocksService } from './match-blocks.service';

/** "Don't match me again", from an errand the customer and the agent shared. */
@Controller('errands/:id/no-match')
@UseGuards(AuthGuard)
export class MatchBlocksController {
  constructor(private readonly blocks: MatchBlocksService) {}

  @Put()
  noMatch(@CurrentAuth() auth: AuthContext, @Param('id', ErrandId) id: string) {
    return this.blocks.choose(auth, id, true);
  }

  @Delete()
  matchAgain(@CurrentAuth() auth: AuthContext, @Param('id', ErrandId) id: string) {
    return this.blocks.choose(auth, id, false);
  }
}
