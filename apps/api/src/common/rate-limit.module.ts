import { Global, Module } from '@nestjs/common';
import { RateLimiter } from './rate-limit';

/** The shared limiter, for the route guard and for live connections. */
@Global()
@Module({ providers: [RateLimiter], exports: [RateLimiter] })
export class RateLimitModule {}
