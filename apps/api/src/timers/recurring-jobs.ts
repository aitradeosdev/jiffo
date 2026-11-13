import { Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { APP_CONFIG, AppConfig } from '../config/app-config';

export type RecurringHandler = () => Promise<unknown>;

/** Work that runs on a schedule (daily payouts, reconciliation). Each run happens once across all API instances. */
export interface RecurringJobs {
  register(name: string, cron: string, handler: RecurringHandler): void;
}

export const RECURRING_JOBS = Symbol('RECURRING_JOBS');
const QUEUE = 'recurring';

/** Tests: nothing runs by itself; a test calls run(name). */
export class MemoryRecurringJobs implements RecurringJobs {
  readonly jobs = new Map<string, { cron: string; handler: RecurringHandler }>();
  register(name: string, cron: string, handler: RecurringHandler) {
    this.jobs.set(name, { cron, handler });
  }
  run(name: string) {
    const job = this.jobs.get(name);
    if (!job) throw new Error(`No recurring job ${name}`);
    return job.handler();
  }
}

@Injectable()
export class BullMqRecurringJobs implements RecurringJobs, OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('RecurringJobs');
  private readonly handlers = new Map<string, { cron: string; handler: RecurringHandler }>();
  private queue: Queue | null = null;
  private worker: Worker | null = null;
  private connections: IORedis[] = [];

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  register(name: string, cron: string, handler: RecurringHandler) {
    this.handlers.set(name, { cron, handler });
  }

  async onApplicationBootstrap() {
    const connect = () => {
      const c = new IORedis(this.config.REDIS_URL, { maxRetriesPerRequest: null });
      this.connections.push(c);
      return c;
    };
    this.queue = new Queue(QUEUE, { connection: connect() });
    for (const [name, { cron }] of this.handlers) {
      await this.queue.upsertJobScheduler(
        name,
        { pattern: cron, tz: 'UTC' },
        { name, opts: { removeOnComplete: 100, removeOnFail: 100 } },
      );
    }
    this.worker = new Worker(
      QUEUE,
      async (job) => {
        const entry = this.handlers.get(job.name);
        if (!entry) throw new Error(`No handler for ${job.name}`);
        const result = await entry.handler();
        this.logger.log(`${job.name} finished: ${JSON.stringify(result)}`);
        return result;
      },
      { connection: connect(), concurrency: 1 },
    );
    this.worker.on('failed', (job, error) => this.logger.error(`${job?.name} failed: ${error.message}`));
  }

  async onApplicationShutdown() {
    await this.worker?.close();
    await this.queue?.close();
    await Promise.all(this.connections.map((c) => c.quit()));
  }
}
