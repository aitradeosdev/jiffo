import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { ADMIN_ROLES } from '../db/schema';
import { ADMIN_ERRAND_EVENTS } from '../errands/errands.service';
import { ERRAND_FILTERS, ErrandsAdminService } from './errands-admin.service';
import { notFound } from '../common/errors';
import { ZodBody } from '../common/zod-body';
import { AdminGuard, CurrentAdmin, Needs } from './admin.guard';
import { AuditService } from './audit.service';
import { OverviewService } from './overview.service';
import { TeamService } from './team.service';
import type { AdminContext } from './admin.types';

const AdminId = new ParseUUIDPipe({ exceptionFactory: () => notFound('admin_not_found', 'Teammate not found') });
const ErrandId = new ParseUUIDPipe({ exceptionFactory: () => notFound('errand_not_found', 'Errand not found') });
const kobo = z.number().int().min(0).max(100_000_000_00);
const ErrandsQuery = z.object({
  country: z.string().length(2).toUpperCase(),
  filter: z.enum(ERRAND_FILTERS).default('all'),
  q: z.string().trim().max(80).optional(),
  before: z.string().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
const ActBody = z.object({
  event: z.enum(ADMIN_ERRAND_EVENTS),
  version: z.number().int().min(0),
  /** Why: shown in the timeline and the audit log. */
  note: z.string().trim().min(5, 'Say why, in a few words').max(1000),
  split: z.object({ agentKobo: kobo, jiffoKobo: kobo, itemsToAgentKobo: kobo, chargeCustomerKobo: kobo }).optional(),
});
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
    private readonly errands: ErrandsAdminService,
  ) {}

  @Get('errands')
  @Needs('read')
  listErrands(@Query(new ZodBody(ErrandsQuery)) query: z.infer<typeof ErrandsQuery>) {
    return this.errands.list(query);
  }

  @Get('disputes')
  @Needs('read')
  disputes(@Query(new ZodBody(CountryQuery)) query: z.infer<typeof CountryQuery>) {
    return this.errands.disputes(query.country);
  }

  @Get('errands/:id')
  @Needs('read')
  errand(@Param('id', ErrandId) id: string) {
    return this.errands.detail(id);
  }

  /** Step in, arrange a redelivery, or settle a dispute. */
  @Post('errands/:id/actions')
  @HttpCode(200)
  @Needs('operate')
  act(
    @CurrentAdmin() admin: AdminContext,
    @Param('id', ErrandId) id: string,
    @Body(new ZodBody(ActBody)) body: z.infer<typeof ActBody>,
  ) {
    return this.errands.act(admin, id, body);
  }

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
