import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { CALLABLE_STATES } from '@jiffo/shared';
import { CALLS, CallsUnavailable, type CallsAdapter } from '../adapters/calls';
import type { AuthContext } from '../auth/auth.types';
import { ChatService } from '../chat/chat.service';
import { conflict, notFound, tooMany, unavailable } from '../common/errors';
import { DB, type Db } from '../db/database.module';
import { errandCalls, errands, users } from '../db/schema';
import { participantRole } from '../errands/access';

/** One call at a time: a second tap this soon gets the first call's answer instead of a second ring. */
const AGAIN_AFTER_MS = 30_000;
/** Calls one person may start on one errand in an hour. */
const PER_HOUR = 10;

/** Masked calls between an errand's customer and its agent. */
@Injectable()
export class CallsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CALLS) private readonly calls: CallsAdapter,
    private readonly chat: ChatService,
  ) {}

  /**
   * Rings the caller's own phone and connects them to the other side of the errand. Neither sees the other's
   * number. The chat gets a note that they called, for both of them and for support.
   */
  async call(errandId: string, auth: AuthContext) {
    const [errand] = await this.db.select().from(errands).where(eq(errands.id, errandId));
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

    const people = await this.db
      .select({ id: users.id, phone: users.phone, firstName: users.firstName })
      .from(users)
      .where(inArray(users.id, [auth.userId, calleeId]));
    const caller = people.find((p) => p.id === auth.userId)!;
    const callee = people.find((p) => p.id === calleeId)!;

    const row = await this.db.transaction(async (tx) => {
      // One at a time per caller and errand, so two quick taps can't both pass the checks and ring twice.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`call:${errandId}:${auth.userId}`}))`);
      const mine = and(eq(errandCalls.errandId, errandId), eq(errandCalls.callerId, auth.userId));
      const [last] = await tx
        .select({ createdAt: errandCalls.createdAt })
        .from(errandCalls)
        .where(mine)
        .orderBy(desc(errandCalls.createdAt))
        .limit(1);
      const sinceLast = last ? Date.now() - last.createdAt.getTime() : Infinity;
      if (sinceLast < AGAIN_AFTER_MS) {
        throw tooMany('call_just_placed', 'Your phone is about to ring. Answer it to be connected.', {
          retryAfterSeconds: Math.ceil((AGAIN_AFTER_MS - sinceLast) / 1000),
        });
      }
      const [{ recent }] = (await tx
        .select({ recent: count() })
        .from(errandCalls)
        .where(and(mine, gte(errandCalls.createdAt, new Date(Date.now() - 3_600_000))))) as [{ recent: number }];
      if (recent >= PER_HOUR) {
        throw tooMany('too_many_calls', 'That is a lot of calls for one errand. Send a message instead.');
      }
      const [inserted] = await tx
        .insert(errandCalls)
        .values({ errandId, callerId: auth.userId, calleeId, callerRole: role, provider: this.calls.name })
        .returning();
      return inserted!;
    });
    let providerRef: string;
    try {
      ({ providerRef } = await this.calls.bridge({ reference: row.id, from: caller.phone, to: callee.phone }));
    } catch (error) {
      // No ring happened: forget the call, so it neither shows in the chat nor counts against the limits.
      await this.db.delete(errandCalls).where(eq(errandCalls.id, row.id));
      if (error instanceof CallsUnavailable) {
        throw unavailable('calls_unavailable', "Calls aren't available yet. Send a message instead.");
      }
      throw error;
    }
    await this.db.update(errandCalls).set({ providerRef }).where(eq(errandCalls.id, row.id));
    await this.chat.system(
      errandId,
      errand.agentId,
      `${caller.firstName ?? (role === 'customer' ? 'The customer' : 'The agent')} called ${
        callee.firstName ?? (role === 'customer' ? 'the agent' : 'the customer')
      }`,
      { type: 'call', callerRole: role },
    );
    return { callId: row.id, status: 'ringing' as const };
  }
}
