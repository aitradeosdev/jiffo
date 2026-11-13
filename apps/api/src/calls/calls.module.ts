import { Module } from '@nestjs/common';
import { ChatModule } from '../chat/chat.module';
import { CallsController, CallsWebhookController } from './calls.controller';
import { CallsService } from './calls.service';

@Module({ imports: [ChatModule], controllers: [CallsController, CallsWebhookController], providers: [CallsService] })
export class CallsModule {}
