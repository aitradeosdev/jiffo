import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DB, type Db } from '../db/database.module';
import { errands } from '../db/schema';
import { formatNaira, TERMINAL_STATES, type CountrySettings, type ErrandEvent } from '@jiffo/shared';
import { ChatService } from '../chat/chat.service';
import { PushService } from '../push/push.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import type { ErrandRow } from './errand-view';

export interface TransitionResult {
  before: ErrandRow;
  after: ErrandRow;
  event: ErrandEvent;
  record: Record<string, unknown>;
  settings: CountrySettings;
}

type Party = 'customer' | 'agent';
const FUNDS_LOW_EVERY_MS = 10 * 60_000;
interface Note {
  /** Who gets the push notification: one side, or both when support acted. */
  to: Party | 'both';
  title: string;
  body: string;
  /** Also written in the chat as a timeline note. */
  chat?: string;
}

const amount = (r: Record<string, unknown>) => formatNaira(Number(r.amountKobo ?? 0));

/** What each event tells the other side. Events missing here only update the screens. */
function noteFor(event: ErrandEvent, r: TransitionResult): Note | null {
  switch (event) {
    case 'accept':
      return {
        to: 'customer',
        title: 'Agent on the way',
        body: 'An agent accepted your errand.',
        chat: 'Agent accepted the errand',
      };
    case 'withdraw':
      return {
        to: 'customer',
        title: 'Finding another agent',
        body: 'Your agent could not continue. We are finding you another.',
      };
    case 'release_agent':
      return { to: 'agent', title: 'Errand released', body: 'The customer asked for a different agent.' };
    case 'cancel':
      return r.before.agentId
        ? { to: 'agent', title: 'Errand cancelled', body: 'The customer cancelled the errand.' }
        : null;
    case 'expire':
      return {
        to: 'customer',
        title: 'No agent found',
        body: 'No agent took your urgent errand in time. Try again or raise the fee.',
      };
    case 'send_offer':
      return {
        to: 'customer',
        title: 'New price',
        body: `Your agent proposed ${amount(r.record)}.`,
        chat: `New price proposed: ${amount(r.record)}`,
      };
    case 'accept_offer':
      return {
        to: 'agent',
        title: 'Price accepted',
        body: `The customer accepted ${amount(r.record)}.`,
        chat: `New price accepted: ${amount(r.record)}`,
      };
    case 'decline_offer':
      return {
        to: 'agent',
        title: 'Price declined',
        body: 'The customer kept the original fee.',
        chat: 'New price declined',
      };
    case 'start':
      return {
        to: 'customer',
        title: 'Errand started',
        body: 'Your agent started the errand.',
        chat: 'Errand started',
      };
    case 'send_item_amount':
      return {
        to: 'customer',
        title: 'Lock the item amount',
        body: `Items cost ${amount(r.record)}. Check the photos and lock it.`,
        chat: `Item amount sent: ${amount(r.record)}`,
      };
    case 'lock_item_amount':
      return {
        to: 'agent',
        title: 'Item amount locked',
        body: 'You can head to the drop-off.',
        chat: 'Item amount locked',
      };
    case 'item_lock_timeout':
      return {
        to: 'agent',
        title: 'Item amount not locked',
        body: 'The customer did not lock the item amount in time. Support will step in.',
      };
    case 'mark_delivered':
      return {
        to: 'customer',
        title: 'Your agent has arrived',
        body: 'Open Jiffo to see your hand-off PIN.',
        chat: 'Marked as delivered',
      };
    case 'confirm_pin':
      return {
        to: 'customer',
        title: 'Errand complete',
        body: 'Hand-off confirmed with your PIN.',
        chat: 'Hand-off confirmed',
      };
    case 'send_dropoff_photo':
      return {
        to: 'customer',
        title: 'Drop-off photo',
        body: 'Your agent left the items. Check the photo and approve it.',
        chat: 'Drop-off photo sent',
      };
    case 'approve_photo':
      return {
        to: 'agent',
        title: 'Drop-off approved',
        body: 'The customer approved the drop-off.',
        chat: 'Drop-off approved',
      };
    case 'auto_release':
      return { to: 'agent', title: 'Errand complete', body: 'The drop-off was approved automatically.' };
    case 'report_unreachable':
      return {
        to: 'customer',
        title: 'We could not reach you',
        body: 'Your agent is at the drop-off. Ask for redelivery in the app.',
        chat: 'Customer unreachable',
      };
    case 'redeliver':
      return r.record.by === 'support'
        ? {
            to: 'both',
            title: 'Redelivery arranged',
            body: 'Jiffo support arranged a redelivery at the same fee.',
            chat: 'Support arranged a redelivery',
          }
        : {
            to: 'agent',
            title: 'Redelivery',
            body: 'The customer asked for redelivery.',
            chat: 'Redelivery requested',
          };
    case 'admin_cancel':
      return {
        to: 'customer',
        title: 'Errand cancelled',
        body: 'Jiffo support cancelled this errand before an agent took it. Nothing was charged.',
      };
    case 'pin_locked':
      return {
        to: 'both',
        title: 'Held for support',
        body: 'Too many wrong PINs were entered. Your money stays held while Jiffo support looks at this errand.',
        chat: 'Too many wrong PINs. Support is looking at this errand; the money stays held until they decide.',
      };
    case 'admin_intervene':
      return {
        to: 'both',
        title: 'Support is reviewing this errand',
        body: 'Jiffo support stepped in. Your money stays held until they decide.',
        chat: 'Support stepped in and is reviewing this errand',
      };
    case 'resolve_complete':
      return {
        to: 'both',
        title: 'Errand settled by support',
        body: 'Jiffo support marked this errand complete. Check your wallet for the details.',
        chat: 'Support settled this errand as complete',
      };
    case 'resolve_cancel':
      return {
        to: 'both',
        title: 'Errand settled by support',
        body: 'Jiffo support cancelled this errand. Check your wallet for the details.',
        chat: 'Support settled this errand as cancelled',
      };
    case 'open_dispute':
      return {
        to: r.record.by === 'customer' ? 'agent' : 'customer',
        title: 'Dispute opened',
        body: 'Support will review this errand.',
        chat: 'Dispute opened. Support will review it.',
      };
    default:
      return null;
  }
}

/** After an errand changes: updates open screens, opens and closes the chat, writes chat notes, sends pushes. */
@Injectable()
export class ErrandNotifier {
  private readonly logger = new Logger(ErrandNotifier.name);
  private readonly fundsLowSentAt = new Map<string, number>();

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly realtime: RealtimeGateway,
    private readonly chat: ChatService,
    private readonly push: PushService,
  ) {}

  /**
   * An agent is ready, but the wallet no longer covers the errand. Sent at most once per errand every
   * 10 minutes, however many agents try, and it never turns the agent's answer into a different error.
   */
  async customerFundsLow(errandId: string) {
    const last = this.fundsLowSentAt.get(errandId) ?? 0;
    if (Date.now() - last < FUNDS_LOW_EVERY_MS) return;
    if (this.fundsLowSentAt.size > 10_000) this.fundsLowSentAt.clear();
    this.fundsLowSentAt.set(errandId, Date.now());
    try {
      const [errand] = await this.db
        .select({ customerId: errands.customerId })
        .from(errands)
        .where(eq(errands.id, errandId));
      if (!errand) return;
      await this.push.notifyUser(errand.customerId, 'customer', {
        title: 'Top up to get your agent',
        body: 'An agent wants to take your errand, but your wallet is short. Top up and they can accept.',
        data: { type: 'wallet.low', errandId },
      });
    } catch (error) {
      this.logger.warn(`Low-funds push for ${errandId} failed: ${(error as Error).message}`);
    }
  }

  async transitioned(r: TransitionResult) {
    try {
      await this.run(r);
    } catch (error) {
      // The errand change is already saved; a failed notification must not undo or fail it.
      this.logger.warn(`Notifying ${r.event} on ${r.after.id} failed: ${(error as Error).message}`);
    }
  }

  private async run(r: TransitionResult) {
    const { before, after, event } = r;
    const agentId = after.agentId ?? before.agentId;

    if (event === 'accept' && after.agentId) {
      await this.chat.open({ errandId: after.id, customerId: after.customerId, agentId: after.agentId });
    }

    const note = noteFor(event, r);
    if (note?.chat && agentId) await this.chat.system(after.id, agentId, note.chat, { event });

    const update = { errandId: after.id, status: after.status, version: after.version, event };
    this.realtime.toErrand(after.id, 'errand.updated', update);
    this.realtime.toUser(after.customerId, 'customer', 'errand.updated', update);
    if (agentId) this.realtime.toUser(agentId, 'agent', 'errand.updated', update);

    if ((event === 'withdraw' || event === 'release_agent') && before.agentId) {
      await this.chat.closeOpen(after.id);
      this.realtime.removeFromErrand(before.agentId, 'agent', after.id);
    }
    if (TERMINAL_STATES.has(after.status)) await this.chat.closeOpen(after.id);

    if (note) {
      const parties: Party[] = note.to === 'both' ? ['customer', 'agent'] : [note.to];
      // Each side on its own, so one failed push never stops the other.
      const sent = await Promise.allSettled(
        parties.map((party) => {
          const userId = party === 'customer' ? after.customerId : agentId;
          if (!userId) return Promise.resolve();
          return this.push.notifyUser(userId, party, {
            title: note.title,
            body: note.body,
            data: { type: 'errand.updated', errandId: after.id, event, status: after.status },
          });
        }),
      );
      for (const r of sent) {
        if (r.status === 'rejected') this.logger.warn(`Push for ${event} on ${after.id} failed: ${String(r.reason)}`);
      }
    }
  }
}
