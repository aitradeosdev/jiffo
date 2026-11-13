import { Module } from '@nestjs/common';
import { ChatModule } from '../chat/chat.module';
import { CallsController } from './calls.controller';
import { CallsService } from './calls.service';

@Module({ imports: [ChatModule], controllers: [CallsController], providers: [CallsService] })
export class CallsModule {}
