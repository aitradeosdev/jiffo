import { Module } from '@nestjs/common';
import { AdaptersModule } from './adapters/adapters.module';
import { AdminModule } from './admin/admin.module';
import { AgentsModule } from './agents/agents.module';
import { AuthModule } from './auth/auth.module';
import { CallsModule } from './calls/calls.module';
import { ChatModule } from './chat/chat.module';
import { ConfigModule } from './config/app-config';
import { CountriesModule } from './countries/countries.module';
import { DatabaseModule } from './db/database.module';
import { ErrandsModule } from './errands/errands.module';
import { HealthController } from './health/health.controller';
import { MoneyModule } from './money/money.module';
import { PlacesModule } from './places/places.module';
import { FilesModule } from './files/files.module';
import { IdentityModule } from './identity/identity.module';
import { RatingsModule } from './ratings/ratings.module';
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
    IdentityModule,
    AgentsModule,
    PushModule,
    RealtimeModule,
    ChatModule,
    CallsModule,
    MoneyModule,
    PlacesModule,
    FilesModule,
    RatingsModule,
    ErrandsModule,
    AdminModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
