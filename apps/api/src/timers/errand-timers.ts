import { Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import type { ErrandState } from '@jiffo/shared';
import { APP_CONFIG, AppConfig } from '../config/app-config';

export type TimerEvent = 'expire' | 'item_lock_timeout' | 'auto_release' | 'unreachable_timeout';

/**
 * A system event due later. It only applies if the errand is still exactly as it was when the timer
 * was set (same status and version), so a timer can never act on an errand that has moved on.
 */
export interface ErrandTimerJob {
  errandId: string;
  event: TimerEvent;
  status: ErrandState;
  version: number;
}

export type TimerHandler = (job: ErrandTimerJob) => Promise<void>;

export interface ErrandTimers {
  schedule(job: ErrandTimerJob, delayMs: number): Promise<void>;
  setHandler(handler: TimerHandler): void;
}

export const ERRAND_TIMERS = Symbol('ERRAND_TIMERS');
const QUEUE = 'errand-timers';

/** Tests: keeps the timers in memory; a test fires them by hand. */
export class MemoryErrandTimers implements ErrandTimers {
  readonly pending: Array<{ job: ErrandTimerJob; delayMs: number }> = [];
  private handler: TimerHandler | null = null;

  async schedule(job: ErrandTimerJob, delayMs: number) {
    this.pending.push({ job, delayMs });
  }

  setHandler(handler: TimerHandler) {
    this.handler = handler;
  }

  /** Fires every pending timer for the errand, as if its time had come. */
  async fireAll(errandId?: string) {
    const due = this.pending.filter((p) => !errandId || p.job.errandId === errandId);
    for (const p of due) this.pending.splice(this.pending.indexOf(p), 1);
    for (const p of due) await this.handler?.(p.job);
    return due.map((p) => p.job);
  }
}

/** Redis-backed delayed jobs. They survive restarts, and run once even with several API instances. */
@Injectable()
export class BullMqErrandTimers implements ErrandTimers, OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('ErrandTimers');
  private readonly queueConnection: IORedis;
  private readonly queue: Queue<ErrandTimerJob>;
  private worker: Worker<ErrandTimerJob> | null = null;
  private workerConnection: IORedis | null = null;
  private handler: TimerHandler | null = null;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.queueConnection = new IORedis(config.REDIS_URL, { maxRetriesPerRequest: null });
    this.queue = new Queue<ErrandTimerJob>(QUEUE, { connection: this.queueConnection });
  }

  async schedule(job: ErrandTimerJob, delayMs: number) {
    await this.queue.add(job.event, job, {
      delay: Math.max(0, delayMs),
      jobId: `${job.errandId}-${job.version}-${job.event}`,
      attempts: 5,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: true,
      removeOnFail: 1_000,
    });
  }

  setHandler(handler: TimerHandler) {
    this.handler = handler;
  }

  onApplicationBootstrap() {
    this.workerConnection = new IORedis(this.config.REDIS_URL, { maxRetriesPerRequest: null });
    this.worker = new Worker<ErrandTimerJob>(
      QUEUE,
      async (job) => {
        if (!this.handler) throw new Error('Errand timer handler is not ready');
        await this.handler(job.data);
      },
      { connection: this.workerConnection, concurrency: 10 },
    );
    this.worker.on('failed', (job, error) => this.logger.warn(`Timer ${job?.id} failed: ${error.message}`));
  }

  async onApplicationShutdown() {
    await this.worker?.close();
    await this.queue.close();
    await Promise.all([this.queueConnection.quit(), this.workerConnection?.quit()]);
  }
}
