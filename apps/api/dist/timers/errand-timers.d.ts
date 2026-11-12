import { OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import type { ErrandState } from '@jiffo/shared';
import { AppConfig } from '../config/app-config';
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
export declare const ERRAND_TIMERS: unique symbol;
/** Tests: keeps the timers in memory; a test fires them by hand. */
export declare class MemoryErrandTimers implements ErrandTimers {
    readonly pending: Array<{
        job: ErrandTimerJob;
        delayMs: number;
    }>;
    private handler;
    schedule(job: ErrandTimerJob, delayMs: number): Promise<void>;
    setHandler(handler: TimerHandler): void;
    /** Fires every pending timer for the errand, as if its time had come. */
    fireAll(errandId?: string): Promise<ErrandTimerJob[]>;
}
/** Redis-backed delayed jobs. They survive restarts, and run once even with several API instances. */
export declare class BullMqErrandTimers implements ErrandTimers, OnApplicationBootstrap, OnApplicationShutdown {
    private readonly config;
    private readonly logger;
    private readonly queueConnection;
    private readonly queue;
    private worker;
    private workerConnection;
    private handler;
    constructor(config: AppConfig);
    schedule(job: ErrandTimerJob, delayMs: number): Promise<void>;
    setHandler(handler: TimerHandler): void;
    onApplicationBootstrap(): void;
    onApplicationShutdown(): Promise<void>;
}
