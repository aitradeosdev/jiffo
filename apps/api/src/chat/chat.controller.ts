import { RateLimit } from '../common/rate-limit';
import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AuthGuard, CurrentAuth } from '../auth/auth.guard';
import type { AuthContext } from '../auth/auth.types';
import { ZodBody } from '../common/zod-body';
import { ErrandId } from '../common/params';
import { ChatService } from './chat.service';

const SendBody = z
  .object({
    // A blank caption is no caption, so a photo with only spaces still sends.
    body: z
      .string()
      .trim()
      .max(2000)
      .optional()
      .transform((v) => v || undefined),
    /** A chat photo uploaded through /v1/uploads for this errand. */
    photo: z.string().min(1).max(300).optional(),
    /** Set by the app per message, so a retried send never shows twice. */
    clientId: z.string().min(1).max(64),
  })
  .refine((b) => b.body || b.photo, 'Send some text or a photo');
const ListQuery = z.object({
  after: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

@Controller('errands/:id/messages')
@UseGuards(AuthGuard)
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Get()
  list(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ErrandId) id: string,
    @Query(new ZodBody(ListQuery)) query: z.infer<typeof ListQuery>,
  ) {
    return this.chat.list(id, auth, query.after, query.limit);
  }

  @Post()
  @RateLimit('chat')
  send(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ErrandId) id: string,
    @Body(new ZodBody(SendBody)) body: z.infer<typeof SendBody>,
  ) {
    return this.chat.send(id, auth, body);
  }
}
