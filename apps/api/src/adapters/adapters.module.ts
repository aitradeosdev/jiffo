import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { DB, type Db } from '../db/database.module';
import { BuiltinChatAdapter } from '../chat/builtin-chat.adapter';
import { ENV_ADAPTERS, envAdapters } from '../providers/env-adapters';
import { ProvidersService } from '../providers/providers.service';
import {
  SwitchingCalls,
  SwitchingIdentity,
  SwitchingMaps,
  SwitchingMessaging,
  SwitchingPayments,
  SwitchingPush,
  SwitchingStorage,
} from '../providers/switching';
import { CALLS } from './calls';
import { CHAT, type ChatAdapter } from './chat';
import { IDENTITY } from './identity';
import { MAPS } from './maps';
import { MESSAGING } from './messaging';
import { PAYMENTS } from './payments';
import { PUSH } from './push';
import { STORAGE } from './storage';

/**
 * One service per outside provider category. Each passes its calls to the provider admin switched on in the
 * panel, or the environment's choice while none is (see ProvidersService).
 */
@Global()
@Module({
  providers: [
    { provide: ENV_ADAPTERS, inject: [APP_CONFIG], useFactory: (c: AppConfig) => envAdapters(c) },
    ProvidersService,
    { provide: PAYMENTS, inject: [ProvidersService], useFactory: (p: ProvidersService) => new SwitchingPayments(p) },
    { provide: MESSAGING, inject: [ProvidersService], useFactory: (p: ProvidersService) => new SwitchingMessaging(p) },
    { provide: PUSH, inject: [ProvidersService], useFactory: (p: ProvidersService) => new SwitchingPush(p) },
    { provide: MAPS, inject: [ProvidersService], useFactory: (p: ProvidersService) => new SwitchingMaps(p) },
    { provide: STORAGE, inject: [ProvidersService], useFactory: (p: ProvidersService) => new SwitchingStorage(p) },
    { provide: IDENTITY, inject: [ProvidersService], useFactory: (p: ProvidersService) => new SwitchingIdentity(p) },
    { provide: CALLS, inject: [ProvidersService], useFactory: (p: ProvidersService) => new SwitchingCalls(p) },
    { provide: CHAT, inject: [DB], useFactory: (db: Db): ChatAdapter => new BuiltinChatAdapter(db) },
  ],
  exports: [ENV_ADAPTERS, ProvidersService, CALLS, IDENTITY, MESSAGING, PUSH, PAYMENTS, MAPS, STORAGE, CHAT],
})
export class AdaptersModule {}
