import { Module } from '@nestjs/common';
import { ErrandsModule } from '../errands/errands.module';
import { ErrandsAdminService } from './errands-admin.service';
import { PeopleAdminService } from './people-admin.service';
import { MoneyAdminService } from './money-admin.service';
import { SettingsAdminService } from './settings-admin.service';
import { PushModule } from '../push/push.module';
import { AdminAuthController } from './admin-auth.controller';
import { AdminAuthService } from './admin-auth.service';
import { AdminController } from './admin.controller';
import { AdminGuard } from './admin.guard';
import { AuditService } from './audit.service';
import { OverviewService } from './overview.service';
import { TeamService } from './team.service';

/** Everything the admin panel calls, under /v1/admin. */
@Module({
  imports: [ErrandsModule, PushModule],
  controllers: [AdminAuthController, AdminController],
  providers: [
    AdminAuthService,
    AdminGuard,
    AuditService,
    ErrandsAdminService,
    MoneyAdminService,
    OverviewService,
    PeopleAdminService,
    SettingsAdminService,
    TeamService,
  ],
  exports: [AdminAuthService, AdminGuard, AuditService],
})
export class AdminModule {}
