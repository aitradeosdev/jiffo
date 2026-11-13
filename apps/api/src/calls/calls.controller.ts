import { Controller, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
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
