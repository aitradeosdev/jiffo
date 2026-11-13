import { Module } from '@nestjs/common';
import { ChatModule } from '../chat/chat.module';
import { ErrandNotifier } from './errand-notifier';
import { ErrandsController } from './errands.controller';
import { ErrandsService } from './errands.service';

@Module({
  imports: [ChatModule],
  controllers: [ErrandsController],
  providers: [ErrandsService, ErrandNotifier],
  exports: [ErrandsService],
})
export class ErrandsModule {}
