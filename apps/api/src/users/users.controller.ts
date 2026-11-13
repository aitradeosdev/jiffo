import { Body, Controller, Get, Inject, Patch, UseGuards } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { DB, type Db } from '../db/database.module';
import { errandEvents, errandRatings, errands, users } from '../db/schema';
import { AuthGuard, CurrentAuth } from '../auth/auth.guard';
import { publicUser } from '../auth/auth.service';
import type { AuthContext } from '../auth/auth.types';
import { ZodBody } from '../common/zod-body';
import { notFound } from '../common/errors';

const Name = z.string().trim().min(1).max(50);
const UpdateMeBody = z
  .object({
    firstName: Name,
    lastName: Name,
    email: z.string().trim().toLowerCase().email().max(254).nullable(),
  })
  .partial()
  .refine((b) => Object.keys(b).length > 0, 'Nothing to update');

@Controller('me')
@UseGuards(AuthGuard)
export class UsersController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Get()
  async me(@CurrentAuth() auth: AuthContext) {
    const [user] = await this.db.select().from(users).where(eq(users.id, auth.userId));
    if (!user) throw notFound('user_not_found', 'Account not found');
    return publicUser(user);
  }

  /** Rating from the other side, finished errands and disputes, for the account screen. */
  @Get('stats')
  async stats(@CurrentAuth() auth: AuthContext) {
    const mine = auth.app === 'customer' ? eq(errands.customerId, auth.userId) : eq(errands.agentId, auth.userId);
    const [[rating], [done], [disputes]] = await Promise.all([
      this.db
        .select({ avg: sql<string | null>`avg(${errandRatings.stars})`, n: sql<number>`count(*)::int` })
        .from(errandRatings)
        .where(
          and(
            eq(errandRatings.rateeId, auth.userId),
            // Rated in this app's role: agents rate customers, customers rate agents.
            eq(errandRatings.raterRole, auth.app === 'customer' ? 'agent' : 'customer'),
          ),
        ),
      this.db
        .select({ n: sql<number>`count(*)::int` })
        .from(errands)
        .where(and(mine, eq(errands.status, 'completed'))),
      // Every way into a dispute counts: opened by either side, a missed deadline, or support stepping in.
      this.db
        .select({ n: sql<number>`count(distinct ${errandEvents.errandId})::int` })
        .from(errandEvents)
        .innerJoin(errands, eq(errands.id, errandEvents.errandId))
        .where(and(mine, eq(errandEvents.toStatus, 'disputed'))),
    ]);
    return {
      ratingAvg: rating?.avg ? Math.round(Number(rating.avg) * 10) / 10 : null,
      ratingCount: rating?.n ?? 0,
      errandsCompleted: done?.n ?? 0,
      disputes: disputes?.n ?? 0,
    };
  }

  @Patch()
  async update(@CurrentAuth() auth: AuthContext, @Body(new ZodBody(UpdateMeBody)) body: z.infer<typeof UpdateMeBody>) {
    const [user] = await this.db
      .update(users)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(users.id, auth.userId))
      .returning();
    if (!user) throw notFound('user_not_found', 'Account not found');
    return publicUser(user);
  }
}
