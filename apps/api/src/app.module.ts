import { Module } from '@nestjs/common';
import { AdaptersModule } from './adapters/adapters.module';
import { AuthModule } from './auth/auth.module';
import { ChatModule } from './chat/chat.module';
import { ConfigModule } from './config/app-config';
import { CountriesModule } from './countries/countries.module';
import { DatabaseModule } from './db/database.module';
import { ErrandsModule } from './errands/errands.module';
import { HealthController } from './health/health.controller';
import { PushModule } from './push/push.module';
import { RealtimeModule } from './realtime/realtime.module';
import { TimersModule } from './timers/timers.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    AdaptersModule,
    TimersModule,
    CountriesModule,
    AuthModule,
    UsersModule,
    PushModule,
    RealtimeModule,
    ChatModule,
    ErrandsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
