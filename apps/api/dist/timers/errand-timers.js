"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BullMqErrandTimers = exports.MemoryErrandTimers = exports.ERRAND_TIMERS = void 0;
const common_1 = require("@nestjs/common");
const bullmq_1 = require("bullmq");
const ioredis_1 = __importDefault(require("ioredis"));
const app_config_1 = require("../config/app-config");
exports.ERRAND_TIMERS = Symbol('ERRAND_TIMERS');
const QUEUE = 'errand-timers';
/** Tests: keeps the timers in memory; a test fires them by hand. */
class MemoryErrandTimers {
    pending = [];
    handler = null;
    async schedule(job, delayMs) {
        this.pending.push({ job, delayMs });
    }
    setHandler(handler) {
        this.handler = handler;
    }
    /** Fires every pending timer for the errand, as if its time had come. */
    async fireAll(errandId) {
        const due = this.pending.filter((p) => !errandId || p.job.errandId === errandId);
        for (const p of due)
            this.pending.splice(this.pending.indexOf(p), 1);
        for (const p of due)
            await this.handler?.(p.job);
        return due.map((p) => p.job);
    }
}
exports.MemoryErrandTimers = MemoryErrandTimers;
/** Redis-backed delayed jobs. They survive restarts, and run once even with several API instances. */
let BullMqErrandTimers = class BullMqErrandTimers {
    config;
    logger = new common_1.Logger('ErrandTimers');
    queueConnection;
    queue;
    worker = null;
    workerConnection = null;
    handler = null;
    constructor(config) {
        this.config = config;
        this.queueConnection = new ioredis_1.default(config.REDIS_URL, { maxRetriesPerRequest: null });
        this.queue = new bullmq_1.Queue(QUEUE, { connection: this.queueConnection });
    }
    async schedule(job, delayMs) {
        await this.queue.add(job.event, job, {
            delay: Math.max(0, delayMs),
            jobId: `${job.errandId}-${job.version}-${job.event}`,
            attempts: 5,
            backoff: { type: 'exponential', delay: 5_000 },
            removeOnComplete: true,
            removeOnFail: 1_000,
        });
    }
    setHandler(handler) {
        this.handler = handler;
    }
    onApplicationBootstrap() {
        this.workerConnection = new ioredis_1.default(this.config.REDIS_URL, { maxRetriesPerRequest: null });
        this.worker = new bullmq_1.Worker(QUEUE, async (job) => {
            if (!this.handler)
                throw new Error('Errand timer handler is not ready');
            await this.handler(job.data);
        }, { connection: this.workerConnection, concurrency: 10 });
        this.worker.on('failed', (job, error) => this.logger.warn(`Timer ${job?.id} failed: ${error.message}`));
    }
    async onApplicationShutdown() {
        await this.worker?.close();
        await this.queue.close();
        await Promise.all([this.queueConnection.quit(), this.workerConnection?.quit()]);
    }
};
exports.BullMqErrandTimers = BullMqErrandTimers;
exports.BullMqErrandTimers = BullMqErrandTimers = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(app_config_1.APP_CONFIG)),
    __metadata("design:paramtypes", [Object])
], BullMqErrandTimers);
//# sourceMappingURL=errand-timers.js.map