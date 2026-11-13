import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, count, desc, eq, inArray, sql } from 'drizzle-orm';
import { CALLABLE_STATES } from '@jiffo/shared';
import { CALLS, CallsUnavailable, type CallsAdapter } from '../adapters/calls';
import type { AuthContext } from '../auth/auth.types';
import { ChatService } from '../chat/chat.service';
import { conflict, notFound, tooMany, unavailable } from '../common/errors';
import { DB, type Db } from '../db/database.module';
import { errandCalls, errands, users } from '../db/schema';
import { participantRole } from '../errands/access';
import { PushService } from '../push/push.service';

/** One call at a time: a second tap this soon gets the first call's answer instead of a second ring. */
const AGAIN_AFTER_SECONDS = 30;
/** Calls one person may start on one errand in an hour. */
const PER_HOUR = 10;

const notAvailable = () => unavailable('calls_unavailable', "Calls aren't available yet. Send a message instead.");

/** Masked calls between an errand's customer and its agent. */
@Injectable()
export class CallsService {
  private readonly logger = new Logger(CallsService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CALLS) private readonly calls: CallsAdapter,
    private readonly chat: ChatService,
    private readonly push: PushService,
  ) {}

  /** Whether calls can be made at all, for the apps to show the call button. */
  get available() {
    return this.calls.name !== 'none';
  }

  /**
   * Rings the caller's own phone and connects them to the other side of the errand. Neither sees the other's
   * number. The other person is told who is calling, and the chat notes the call for both and for support.
   */
  async call(errandId: string, auth: AuthContext) {
    if (!this.available) throw notAvailable();
    const { row, errand, role, callerName, calleeName } = await this.db.transaction(async (tx) => {
      // One at a time per caller and errand, so two quick taps can't both ring.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`call:${errandId}:${auth.userId}`}))`);
      // The errand can't end or change hands while the call is placed.
      const [errand] = await tx.select().from(errands).where(eq(errands.id, errandId)).for('share');
      const role = participantRole(errand, auth);
      if (!errand || !role) throw notFound('errand_not_found', 'Errand not found');
      if (!errand.agentId || !CALLABLE_STATES.has(errand.status)) {
        throw conflict(
          'call_not_available',
          errand.status === 'disputed'
            ? 'While the errand is in dispute, our support team talks to each of you'
            : 'Calls work while an agent is on the errand, until it ends',
        );
      }
      const calleeId = role === 'customer' ? errand.agentId : errand.customerId;

      // Times are the database's, the same clock that stamped the calls.
      const mine = and(eq(errandCalls.errandId, errandId), eq(errandCalls.callerId, auth.userId));
      const [last] = await tx
        .select({ seconds: sql<number>`extract(epoch from now() - ${errandCalls.createdAt})::float` })
        .from(errandCalls)
        .where(mine)
        .orderBy(desc(errandCalls.createdAt))
        .limit(1);
      if (last && last.seconds < AGAIN_AFTER_SECONDS) {
        throw tooMany('call_just_placed', 'Your phone is about to ring. Answer it to be connected.', {
          retryAfterSeconds: Math.max(1, Math.ceil(AGAIN_AFTER_SECONDS - last.seconds)),
        });
      }
      const [{ recent }] = (await tx
        .select({ recent: count() })
        .from(errandCalls)
        .where(and(mine, sql`${errandCalls.createdAt} > now() - interval '1 hour'`))) as [{ recent: number }];
      if (recent >= PER_HOUR) {
        throw tooMany('too_many_calls', 'That is a lot of calls for one errand. Send a message instead.');
      }

      const people = await tx
        .select({ id: users.id, phone: users.phone, firstName: users.firstName })
        .from(users)
        .where(inArray(users.id, [auth.userId, calleeId]));
      const [inserted] = await tx
        .insert(errandCalls)
        .values({ errandId, callerId: auth.userId, calleeId, callerRole: role, provider: this.calls.name })
        .returning();
      // Rung inside the transaction: if the provider refuses, nothing is kept and the next tap rings at once.
      let providerRef: string;
      try {
        ({ providerRef } = await this.calls.bridge({
          reference: inserted!.id,
          from: people.find((p) => p.id === auth.userId)!.phone,
          to: people.find((p) => p.id === calleeId)!.phone,
        }));
      } catch (error) {
        if (error instanceof CallsUnavailable) throw notAvailable();
        throw error;
      }
      const [row] = await tx
        .update(errandCalls)
        .set({ providerRef })
        .where(eq(errandCalls.id, inserted!.id))
        .returning();
      const nameOf = (id: string) => people.find((p) => p.id === id)?.firstName;
      return {
        row: row!,
        errand,
        role,
        callerName: nameOf(auth.userId) ?? (role === 'customer' ? 'The customer' : 'Your agent'),
        calleeName: nameOf(calleeId) ?? (role === 'customer' ? 'the agent' : 'the customer'),
      };
    });

    // The phone is ringing now: nothing after this may turn the answer into an error.
    const notes = await Promise.allSettled([
      this.chat.system(errandId, errand.agentId!, `${callerName} called ${calleeName}`, {
        type: 'call',
        callerRole: role,
      }),
      this.push.notifyUser(row.calleeId, role === 'customer' ? 'agent' : 'customer', {
        title: `${callerName} is calling you`,
        body: 'Through Jiffo, from a number you may not know. Answer to talk about your errand.',
        data: { type: 'errand.call', errandId },
      }),
    ]);
    for (const note of notes) {
      if (note.status === 'rejected')
        this.logger.warn(`Call ${row.id} placed, but a note failed: ${String(note.reason)}`);
    }
    return { callId: row.id, status: 'ringing' as const };
  }
}
