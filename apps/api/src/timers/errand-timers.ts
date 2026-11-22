import { Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import type { ErrandState } from '@jiffo/shared';
import { APP_CONFIG, AppConfig } from '../config/app-config';

export type TimerEvent =
  | 'expire'
  | 'item_lock_timeout'
  | 'auto_release'
  | 'unreachable_timeout'
  | 'release_reminder'
  /** An offer's time is up (docs/matching.md, M6). */
  | 'offer_expire'
  /** Look again for someone to offer an urgent errand to. */
  | 'offer_dispatch'
  /** Offer the urgent errands waiting for a first offer in the errand's state together (docs/matching.md, M5). */
  | 'offer_batch'
  /** Still waiting: ask the customer whether to raise the fee (docs/matching.md, M8). */
  | 'raise_prompt'
  /** A scheduled errand's agent should be online by now: remind one who isn't (docs/matching.md, M12). */
  | 'scheduled_reminder'
  /** A scheduled errand's agent still isn't online: take it back and send it as urgent (M12). */
  | 'take_back';

/**
 * A system event due later. It only applies if the errand is still exactly as it was when the timer
 * was set (same status and version), so a timer can never act on an errand that has moved on.
 */
export interface ErrandTimerJob {
  errandId: string;
  /** A system event, or release_reminder: a reminder to the customer, which changes nothing (X3). */
  event: TimerEvent;
  status: ErrandState;
  version: number;
  /** For a reminder: the hours after the drop-off photo it is for. */
  remindAt?: number;
  /** For an offer's time running out: which offer. */
  offerId?: string;
  /** Makes a job its own when several of one kind can wait for one errand version (a dispatch retry). */
  key?: string;
  /** For a scheduled errand's reminder and take-back: the agent who took it, whom they are for (M12). */
  agentId?: string;
  /** For the reminder: how many minutes before the start the take-back was set for, to tell the agent (M12). */
  takeBackMinutes?: number;
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
  fireAll(errandId?: string) {
    return this.fireWhere((job) => !errandId || job.errandId === errandId);
  }

  /** Fires the pending timers that match, as if their time had come. */
  async fireWhere(match: (job: ErrandTimerJob) => boolean) {
    const due = this.pending.filter((p) => match(p.job));
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
      jobId: [job.errandId, job.version, job.event, job.remindAt, job.offerId, job.key]
        .filter((p) => p !== undefined)
        .join('-'),
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
