import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { ADMIN_ROLES } from '../db/schema';
import { notFound } from '../common/errors';
import { ZodBody } from '../common/zod-body';
import { AdminGuard, CurrentAdmin, Needs } from './admin.guard';
import { AuditService } from './audit.service';
import { OverviewService } from './overview.service';
import { TeamService } from './team.service';
import type { AdminContext } from './admin.types';

const AdminId = new ParseUUIDPipe({ exceptionFactory: () => notFound('admin_not_found', 'Teammate not found') });
const CountryQuery = z.object({ country: z.string().length(2).toUpperCase() });
const InviteBody = z.object({
  email: z.string().email().max(200),
  name: z.string().trim().min(1).max(80),
  role: z.enum(ADMIN_ROLES),
});
const UpdateBody = z
  .object({ role: z.enum(ADMIN_ROLES), status: z.enum(['active', 'disabled']) })
  .partial()
  .refine((b) => Object.keys(b).length > 0, 'Nothing to update');
const AuditQuery = z.object({
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  targetType: z.string().max(40).optional(),
  targetId: z.string().max(80).optional(),
});

@Controller('admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(
    private readonly overviewService: OverviewService,
    private readonly team: TeamService,
    private readonly audit: AuditService,
  ) {}

  @Get('overview')
  @Needs('read')
  overview(@Query(new ZodBody(CountryQuery)) query: z.infer<typeof CountryQuery>) {
    return this.overviewService.overview(query.country);
  }

  @Get('team')
  @Needs('team')
  listTeam() {
    return this.team.list();
  }

  @Post('team')
  @Needs('team')
  invite(@CurrentAdmin() admin: AdminContext, @Body(new ZodBody(InviteBody)) body: z.infer<typeof InviteBody>) {
    return this.team.invite(admin, body);
  }

  @Patch('team/:id')
  @Needs('team')
  update(
    @CurrentAdmin() admin: AdminContext,
    @Param('id', AdminId) id: string,
    @Body(new ZodBody(UpdateBody)) body: z.infer<typeof UpdateBody>,
  ) {
    return this.team.update(admin, id, body);
  }

  /** A new invite link, clearing their password and authenticator app. */
  @Post('team/:id/reset')
  @Needs('team')
  reset(@CurrentAdmin() admin: AdminContext, @Param('id', AdminId) id: string) {
    return this.team.reset(admin, id);
  }

  @Get('audit')
  @Needs('team')
  auditLog(@Query(new ZodBody(AuditQuery)) query: z.infer<typeof AuditQuery>) {
    return this.audit.list(query);
  }
}
