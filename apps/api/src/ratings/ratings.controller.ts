import { Body, Controller, HttpCode, Inject, Param, Post, UseGuards } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { DB, type Db } from '../db/database.module';
import { errandRatings, errands } from '../db/schema';
import { AuthGuard, CurrentAuth } from '../auth/auth.guard';
import type { AuthContext } from '../auth/auth.types';
import { ZodBody } from '../common/zod-body';
import { ErrandId } from '../common/params';
import { conflict, notFound } from '../common/errors';
import { participantRole } from '../errands/access';

const RatingBody = z.object({
  stars: z.number().int().min(1).max(5),
  comment: z.string().trim().max(500).optional(),
});

/** After an errand completes, the customer rates the agent and the agent rates the customer, once each. */
@Controller('errands/:id/rating')
@UseGuards(AuthGuard)
export class RatingsController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Post()
  @HttpCode(201)
  async rate(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ErrandId) id: string,
    @Body(new ZodBody(RatingBody)) body: z.infer<typeof RatingBody>,
  ) {
    const [errand] = await this.db.select().from(errands).where(eq(errands.id, id));
    const role = participantRole(errand, auth);
    if (!errand || !role) throw notFound('errand_not_found', 'Errand not found');
    if (errand.status !== 'completed' || !errand.agentId)
      throw conflict('rating_not_available', 'You can rate once the errand is complete');
    const [row] = await this.db
      .insert(errandRatings)
      .values({
        errandId: id,
        raterRole: role,
        raterId: auth.userId,
        rateeId: role === 'customer' ? errand.agentId : errand.customerId,
        stars: body.stars,
        comment: body.comment || null,
      })
      .onConflictDoNothing()
      .returning();
    if (!row) throw conflict('already_rated', 'You already rated this errand');
    return { stars: row.stars, comment: row.comment };
  }
}
