import { Module } from '@nestjs/common';
import { ChatModule } from '../chat/chat.module';
import { ErrandNotifier } from './errand-notifier';
import { ErrandsController } from './errands.controller';
import { ErrandsService } from './errands.service';
import { ERRANDS } from './errands.token';

@Module({
  imports: [ChatModule],
  controllers: [ErrandsController],
  providers: [ErrandsService, ErrandNotifier, { provide: ERRANDS, useExisting: ErrandsService }],
  exports: [ErrandsService],
})
export class ErrandsModule {}
