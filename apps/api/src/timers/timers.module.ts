import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { BullMqErrandTimers, ERRAND_TIMERS, MemoryErrandTimers } from './errand-timers';

@Global()
@Module({
  providers: [
    {
      provide: ERRAND_TIMERS,
      inject: [APP_CONFIG],
      useFactory: (c: AppConfig) =>
        c.TIMER_PROVIDER === 'memory' ? new MemoryErrandTimers() : new BullMqErrandTimers(c),
    },
  ],
  exports: [ERRAND_TIMERS],
})
export class TimersModule {}
