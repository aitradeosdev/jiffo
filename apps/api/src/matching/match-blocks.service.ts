import { Inject, Injectable } from '@nestjs/common';
import { TERMINAL_STATES } from '@jiffo/shared';
import { and, eq } from 'drizzle-orm';
import type { AuthContext } from '../auth/auth.types';
import { conflict, notFound } from '../common/errors';
import { DB, type Db } from '../db/database.module';
import { errands, matchBlocks } from '../db/schema';
import { participantRole } from '../errands/access';

/**
 * "Don't match me again" (docs/matching.md, M1): the customer or the agent on an errand chooses never to be
 * matched with the other person, and can change their mind there. Matching keeps the two apart either way
 * (EligibilityService); the other person is never told.
 */
@Injectable()
export class MatchBlocksService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /**
   * The other person on the errand for its customer or agent, or why there is none. Chosen once the errand has
   * ended, when the people on it can no longer change, so the choice can always be undone from the same errand.
   */
  private async other(auth: AuthContext, errandId: string) {
    const [errand] = await this.db.select().from(errands).where(eq(errands.id, errandId));
    const role = participantRole(errand, auth);
    if (!errand || !role) throw notFound('errand_not_found', 'Errand not found');
    const other = role === 'customer' ? errand.agentId : errand.customerId;
    if (!other) throw conflict('no_agent', 'You can choose this once an agent has taken the errand');
    if (!TERMINAL_STATES.has(errand.status)) {
      throw conflict('not_ended', 'You can choose this once the errand has ended');
    }
    return other;
  }

  async choose(auth: AuthContext, errandId: string, noMatch: boolean) {
    const other = await this.other(auth, errandId);
    if (noMatch) {
      await this.db
        .insert(matchBlocks)
        .values({ userId: auth.userId, otherUserId: other, errandId })
        .onConflictDoNothing();
    } else {
      await this.db
        .delete(matchBlocks)
        .where(and(eq(matchBlocks.userId, auth.userId), eq(matchBlocks.otherUserId, other)));
    }
    return { noMatch };
  }

  /** Whether this person chose not to be matched with the other again. */
  async chose(userId: string, otherUserId: string | null) {
    if (!otherUserId) return false;
    const [row] = await this.db
      .select({ userId: matchBlocks.userId })
      .from(matchBlocks)
      .where(and(eq(matchBlocks.userId, userId), eq(matchBlocks.otherUserId, otherUserId)));
    return !!row;
  }
}
