import { Body, Controller, Get, Inject, Patch, UseGuards } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { DB, type Db } from '../db/database.module';
import { users } from '../db/schema';
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
