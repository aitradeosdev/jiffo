import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { BullMqErrandTimers, ERRAND_TIMERS, MemoryErrandTimers } from './errand-timers';
import { BullMqRecurringJobs, MemoryRecurringJobs, RECURRING_JOBS } from './recurring-jobs';

@Global()
@Module({
  providers: [
    {
      provide: ERRAND_TIMERS,
      inject: [APP_CONFIG],
      useFactory: (c: AppConfig) =>
        c.TIMER_PROVIDER === 'memory' ? new MemoryErrandTimers() : new BullMqErrandTimers(c),
    },
    {
      provide: RECURRING_JOBS,
      inject: [APP_CONFIG],
      useFactory: (c: AppConfig) =>
        c.TIMER_PROVIDER === 'memory' ? new MemoryRecurringJobs() : new BullMqRecurringJobs(c),
    },
  ],
  exports: [ERRAND_TIMERS, RECURRING_JOBS],
})
export class TimersModule {}
