import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { Apps, AuthGuard, CurrentAuth } from '../auth/auth.guard';
import type { AuthContext } from '../auth/auth.types';
import { ZodBody } from '../common/zod-body';
import { AgentsService } from './agents.service';

const PreferencesBody = z
  .object({
    /** null receives every category; an empty list is not allowed (the agent would see nothing). */
    categoryKeys: z.array(z.string().min(1).max(40)).min(1).max(50).nullable(),
    takesPurchases: z.boolean(),
  })
  .partial()
  .refine((b) => Object.keys(b).length > 0, 'Nothing to update');

@Controller('agent/profile')
@UseGuards(AuthGuard)
@Apps('agent')
export class AgentsController {
  constructor(private readonly agents: AgentsService) {}

  @Get()
  get(@CurrentAuth() auth: AuthContext) {
    return this.agents.profile(auth.userId);
  }

  @Patch()
  update(@CurrentAuth() auth: AuthContext, @Body(new ZodBody(PreferencesBody)) body: z.infer<typeof PreferencesBody>) {
    return this.agents.updatePreferences(auth, body);
  }
}
