import { Module } from '@nestjs/common';
import { ErrandsModule } from '../errands/errands.module';
import { ErrandsAdminService } from './errands-admin.service';
import { AdminAuthController } from './admin-auth.controller';
import { AdminAuthService } from './admin-auth.service';
import { AdminController } from './admin.controller';
import { AdminGuard } from './admin.guard';
import { AuditService } from './audit.service';
import { OverviewService } from './overview.service';
import { TeamService } from './team.service';

/** Everything the admin panel calls, under /v1/admin. */
@Module({
  imports: [ErrandsModule],
  controllers: [AdminAuthController, AdminController],
  providers: [AdminAuthService, AdminGuard, AuditService, ErrandsAdminService, OverviewService, TeamService],
  exports: [AdminAuthService, AdminGuard, AuditService],
})
export class AdminModule {}
