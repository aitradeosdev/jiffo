import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { ADMIN_ROLES } from '../db/schema';
import { ADMIN_ERRAND_EVENTS } from '../errands/errands.service';
import { ERRAND_FILTERS, ErrandsAdminService } from './errands-admin.service';
import { PEOPLE_ROLES, PeopleAdminService } from './people-admin.service';
import { MAX_ADJUSTMENT_KOBO, MoneyAdminService } from './money-admin.service';
import { SettingsAdminService } from './settings-admin.service';
import { AGENT_TIERS } from '@jiffo/shared';
import { notFound } from '../common/errors';
import { ZodBody } from '../common/zod-body';
import { AdminGuard, CurrentAdmin, Needs } from './admin.guard';
import { AuditService } from './audit.service';
import { OverviewService } from './overview.service';
import { TeamService } from './team.service';
import type { AdminContext } from './admin.types';

const AdminId = new ParseUUIDPipe({ exceptionFactory: () => notFound('admin_not_found', 'Teammate not found') });
const PersonId = new ParseUUIDPipe({ exceptionFactory: () => notFound('person_not_found', 'Person not found') });
const PeopleQuery = z.object({
  country: z.string().length(2).toUpperCase(),
  role: z.enum(PEOPLE_ROLES).default('customer'),
  q: z.string().trim().max(80).optional(),
  before: z.string().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
/** Why: kept in the audit log. */
const Note = z.string().trim().min(5, 'Say why, in a few words').max(1000);
const SummaryQuery = z.object({
  country: z.string().length(2).toUpperCase(),
  days: z.coerce.number().int().min(1).max(90).default(30),
});
const MoneyListQuery = z.object({
  country: z.string().length(2).toUpperCase(),
  q: z.string().trim().max(80).optional(),
  before: z.string().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
const DepositsQuery = MoneyListQuery.extend({
  filter: z.enum(['all', 'pending', 'expired', 'failed', 'mismatch']).default('all'),
});
const PayoutsQuery = MoneyListQuery.extend({ filter: z.enum(['all', 'pending', 'failed']).default('all') });
const AdjustBody = z.object({
  personId: z.string().uuid(),
  account: z.enum(['customer_wallet', 'agent_available']),
  direction: z.enum(['credit', 'debit']),
  amountKobo: z.number().int().min(1).max(MAX_ADJUSTMENT_KOBO),
  note: z.string().trim().min(5, 'Say why, in a few words').max(1000),
  errandId: z.string().uuid().optional(),
  requestId: z.string().uuid(),
});
const CategoryId = new ParseUUIDPipe({ exceptionFactory: () => notFound('category_not_found', 'Category not found') });
const StateId = new ParseUUIDPipe({ exceptionFactory: () => notFound('state_not_found', 'State not found') });
const SaveSettingsBody = z.object({
  basedOn: z.number().int().positive(),
  settings: z.record(z.unknown()),
  note: z.string().trim().min(5, 'Say why, in a few words').max(1000),
});
const CategoryFields = z.object({
  name: z.string().trim().min(2).max(60),
  icon: z.string().trim().min(1).max(40),
  description: z.string().trim().max(200).default(''),
  buyDefault: z.boolean().default(false),
  sort: z.number().int().min(0).max(1000).default(0),
});
const CreateCategoryBody = CategoryFields.extend({
  country: z.string().length(2).toUpperCase(),
  /** Stays fixed: errands and agents' preferences refer to it. */
  key: z.string().regex(/^[a-z][a-z0-9_]{1,30}$/, 'Lower-case letters, numbers and _, starting with a letter'),
});
const UpdateCategoryBody = CategoryFields.extend({ active: z.boolean() })
  .partial()
  .refine((b) => Object.keys(b).length > 0, 'Nothing to update');
const UpdateStateBody = z
  .object({ enabled: z.boolean(), agentSignups: z.enum(['open', 'waitlist']) })
  .partial()
  .refine((b) => Object.keys(b).length > 0, 'Nothing to update');
const TierBody = z.object({ tier: z.enum(AGENT_TIERS), note: Note });
const NoteBody = z.object({ note: Note });
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
    private readonly people: PeopleAdminService,
    private readonly money: MoneyAdminService,
    private readonly settingsAdmin: SettingsAdminService,
  ) {}

  @Get('settings')
  @Needs('read')
  settings(@Query(new ZodBody(CountryQuery)) query: z.infer<typeof CountryQuery>) {
    return this.settingsAdmin.settings(query.country);
  }

  /** Saves the next version of a country's settings. Owners only. */
  @Post('settings')
  @HttpCode(200)
  @Needs('settings')
  saveSettings(
    @CurrentAdmin() admin: AdminContext,
    @Query(new ZodBody(CountryQuery)) query: z.infer<typeof CountryQuery>,
    @Body(new ZodBody(SaveSettingsBody)) body: z.infer<typeof SaveSettingsBody>,
  ) {
    return this.settingsAdmin.saveSettings(admin, query.country, body);
  }

  @Get('categories')
  @Needs('read')
  categories(@Query(new ZodBody(CountryQuery)) query: z.infer<typeof CountryQuery>) {
    return this.settingsAdmin.categories(query.country);
  }

  @Post('categories')
  @Needs('settings')
  createCategory(
    @CurrentAdmin() admin: AdminContext,
    @Body(new ZodBody(CreateCategoryBody)) body: z.infer<typeof CreateCategoryBody>,
  ) {
    return this.settingsAdmin.createCategory(admin, body);
  }

  @Patch('categories/:id')
  @Needs('settings')
  updateCategory(
    @CurrentAdmin() admin: AdminContext,
    @Param('id', CategoryId) id: string,
    @Body(new ZodBody(UpdateCategoryBody)) body: z.infer<typeof UpdateCategoryBody>,
  ) {
    return this.settingsAdmin.updateCategory(admin, id, body);
  }

  @Delete('categories/:id')
  @Needs('settings')
  deleteCategory(@CurrentAdmin() admin: AdminContext, @Param('id', CategoryId) id: string) {
    return this.settingsAdmin.deleteCategory(admin, id);
  }

  @Get('states')
  @Needs('read')
  states(@Query(new ZodBody(CountryQuery)) query: z.infer<typeof CountryQuery>) {
    return this.settingsAdmin.states(query.country);
  }

  @Patch('states/:id')
  @Needs('settings')
  updateState(
    @CurrentAdmin() admin: AdminContext,
    @Param('id', StateId) id: string,
    @Body(new ZodBody(UpdateStateBody)) body: z.infer<typeof UpdateStateBody>,
  ) {
    return this.settingsAdmin.updateState(admin, id, body);
  }

  @Get('money/summary')
  @Needs('read')
  moneySummary(@Query(new ZodBody(SummaryQuery)) query: z.infer<typeof SummaryQuery>) {
    return this.money.summary(query.country, query.days);
  }

  @Get('money/deposits')
  @Needs('read')
  moneyDeposits(@Query(new ZodBody(DepositsQuery)) query: z.infer<typeof DepositsQuery>) {
    return this.money.deposits(query);
  }

  @Get('money/payouts')
  @Needs('read')
  moneyPayouts(@Query(new ZodBody(PayoutsQuery)) query: z.infer<typeof PayoutsQuery>) {
    return this.money.payouts(query);
  }

  @Get('money/reconciliation')
  @Needs('read')
  moneyReconciliation(@Query(new ZodBody(CountryQuery)) query: z.infer<typeof CountryQuery>) {
    return this.money.reconciliation(query.country);
  }

  /** Finance and owners only: a credit or debit on a wallet or agent balance, with a reason. */
  @Post('money/adjustments')
  @HttpCode(200)
  @Needs('money')
  adjust(@CurrentAdmin() admin: AdminContext, @Body(new ZodBody(AdjustBody)) body: z.infer<typeof AdjustBody>) {
    return this.money.adjust(admin, body);
  }

  @Get('people')
  @Needs('read')
  listPeople(@Query(new ZodBody(PeopleQuery)) query: z.infer<typeof PeopleQuery>) {
    return this.people.list(query);
  }

  @Get('people/:id')
  @Needs('read')
  person(@Param('id', PersonId) id: string) {
    return this.people.detail(id);
  }

  @Post('people/:id/tier')
  @HttpCode(200)
  @Needs('operate')
  setTier(
    @CurrentAdmin() admin: AdminContext,
    @Param('id', PersonId) id: string,
    @Body(new ZodBody(TierBody)) body: z.infer<typeof TierBody>,
  ) {
    return this.people.setTier(admin, id, body.tier, body.note);
  }

  @Post('people/:id/suspend')
  @HttpCode(200)
  @Needs('operate')
  suspend(
    @CurrentAdmin() admin: AdminContext,
    @Param('id', PersonId) id: string,
    @Body(new ZodBody(NoteBody)) body: z.infer<typeof NoteBody>,
  ) {
    return this.people.suspend(admin, id, body.note);
  }

  @Post('people/:id/reactivate')
  @HttpCode(200)
  @Needs('operate')
  reactivate(
    @CurrentAdmin() admin: AdminContext,
    @Param('id', PersonId) id: string,
    @Body(new ZodBody(NoteBody)) body: z.infer<typeof NoteBody>,
  ) {
    return this.people.reactivate(admin, id, body.note);
  }

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
