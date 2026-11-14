import { Global, Inject, Module, OnModuleInit } from '@nestjs/common';
import { RECURRING_JOBS, type RecurringJobs } from '../timers/recurring-jobs';
import { AuthController } from './auth.controller';
import { AuthGuard, SessionVerifier } from './auth.guard';
import { AuthService } from './auth.service';
import { OtpService } from './otp.service';
import { TokensService } from './tokens.service';

@Global()
@Module({
  controllers: [AuthController],
  providers: [AuthService, OtpService, TokensService, SessionVerifier, AuthGuard],
  exports: [TokensService, SessionVerifier, AuthGuard],
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
