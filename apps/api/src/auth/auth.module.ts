import { Global, Module } from '@nestjs/common';
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
export class AuthModule {}
