import { Global, Inject, Module, OnModuleInit } from '@nestjs/common';
import { RECURRING_JOBS, type RecurringJobs } from '../timers/recurring-jobs';
import { AuthController } from './auth.controller';
import { AuthGuard, SessionVerifier } from './auth.guard';
import { AuthService } from './auth.service';
import { DeviceSecurityController } from './device-security.controller';
import { DeviceSecurityService } from './device-security.service';
import { SignedGuard } from './signed.guard';
import { OtpService } from './otp.service';
import { TokensService } from './tokens.service';

@Global()
@Module({
  controllers: [AuthController, DeviceSecurityController],
  providers: [AuthService, OtpService, TokensService, SessionVerifier, AuthGuard, DeviceSecurityService, SignedGuard],
  exports: [TokensService, SessionVerifier, AuthGuard, DeviceSecurityService, SignedGuard],
})
export class AuthModule implements OnModuleInit {
  constructor(
    @Inject(RECURRING_JOBS) private readonly jobs: RecurringJobs,
    private readonly otp: OtpService,
  ) {}

  onModuleInit() {
    // Every 10 minutes, tell finance if a country is sending more sign-in codes than its alert level.
    this.jobs.register('sms.spend', '*/10 * * * *', () => this.otp.checkSpend());
  }
}
