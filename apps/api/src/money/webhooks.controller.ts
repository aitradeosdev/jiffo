import { Controller, HttpCode, Inject, Logger, Param, Post, Req } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { and, eq } from 'drizzle-orm';
import { DB, type Db } from '../db/database.module';
import { providerEvents } from '../db/schema';
import { badRequest, notFound, unauthorized } from '../common/errors';
import { ProvidersService } from '../providers/providers.service';
import { DepositsService } from './deposits.service';
import { PayoutsService } from './payouts.service';

/**
 * Payment provider webhooks. The signature is checked on the raw body, every event is stored, a repeat
 * delivery is acknowledged without being applied twice, and the status is always re-read from the
 * provider before money moves.
 */
@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly providers: ProvidersService,
    private readonly deposits: DepositsService,
    private readonly payouts: PayoutsService,
  ) {}

  /**
   * One address per payments provider (/webhooks/paystack and so on). A provider that admin switched away
   * from still delivers here for what it started, as long as its keys are kept.
   */
  @Post(':provider')
  @HttpCode(200)
  async receive(@Param('provider') provider: string, @Req() req: RawBodyRequest<Request>) {
    const payments = this.providers.named('payments', provider);
    if (!payments) throw notFound('not_found', 'Not found');
    if (!req.rawBody) throw badRequest('invalid_request', 'Missing body');
    const event = payments.parseWebhook(req.rawBody, req.headers);
    if (!event) throw unauthorized('invalid_signature', 'Signature does not match');

    const kind = event.kind === 'ignored' ? event.event : event.kind;
    await this.db
      .insert(providerEvents)
      .values({ provider, eventKey: event.eventKey, kind, payload: event.raw })
      .onConflictDoNothing();
    const [stored] = await this.db
      .select()
      .from(providerEvents)
      .where(and(eq(providerEvents.provider, provider), eq(providerEvents.eventKey, event.eventKey)));
    if (stored?.processedAt) return { received: true, duplicate: true };

    try {
      if (event.kind === 'deposit') await this.deposits.sync(event.reference);
      if (event.kind === 'transfer') await this.payouts.sync(event.reference);
    } catch (error) {
      const message = (error as Error).message;
      await this.db.update(providerEvents).set({ error: message }).where(eq(providerEvents.id, stored!.id));
      this.logger.error(`Webhook ${event.eventKey} failed: ${message}`);
      // A non-200 answer makes the provider deliver it again later.
      throw error;
    }
    await this.db
      .update(providerEvents)
      .set({ processedAt: new Date(), error: null })
      .where(eq(providerEvents.id, stored!.id));
    return { received: true };
  }
}
