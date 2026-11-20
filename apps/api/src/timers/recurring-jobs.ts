import { Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { APP_CONFIG, AppConfig } from '../config/app-config';

export type RecurringHandler = () => Promise<unknown>;
export interface RecurringOptions {
  /**
   * Asked as the server starts: when it says yes, the job also runs once then, rather than waiting for its
   * time (a table the job fills that is still empty). Not in tests, where nothing runs by itself.
   */
  runAtStartIf?: () => Promise<boolean>;
}

/** Work that runs on a schedule (daily payouts, reconciliation). Each run happens once across all API instances. */
export interface RecurringJobs {
  register(name: string, cron: string, handler: RecurringHandler, options?: RecurringOptions): void;
}

export const RECURRING_JOBS = Symbol('RECURRING_JOBS');
const QUEUE = 'recurring';

/** Tests: nothing runs by itself; a test calls run(name). */
export class MemoryRecurringJobs implements RecurringJobs {
  readonly jobs = new Map<string, { cron: string; handler: RecurringHandler } & RecurringOptions>();
  register(name: string, cron: string, handler: RecurringHandler, options: RecurringOptions = {}) {
    this.jobs.set(name, { cron, handler, ...options });
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
  private readonly handlers = new Map<string, { cron: string; handler: RecurringHandler } & RecurringOptions>();
  private queue: Queue | null = null;
  private worker: Worker | null = null;
  private connections: IORedis[] = [];

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  register(name: string, cron: string, handler: RecurringHandler, options: RecurringOptions = {}) {
    this.handlers.set(name, { cron, handler, ...options });
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
    // Jobs that should run now as well, queued so one instance runs each. Asked beside the start, not before it.
    for (const [name, { runAtStartIf }] of this.handlers) {
      if (!runAtStartIf) continue;
      void runAtStartIf()
        .then((yes) => (yes ? this.queue?.add(name, {}, { removeOnComplete: 100, removeOnFail: 100 }) : undefined))
        .catch((error: Error) => this.logger.error(`${name} couldn't be queued at start: ${error.message}`));
    }
  }

  async onApplicationShutdown() {
    await this.worker?.close();
    await this.queue?.close();
    await Promise.all(this.connections.map((c) => c.quit()));
  }
}
