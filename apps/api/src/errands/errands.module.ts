import { Module } from '@nestjs/common';
import { ChatModule } from '../chat/chat.module';
import { ErrandNotifier } from './errand-notifier';
import { ErrandsController } from './errands.controller';
import { ErrandsService } from './errands.service';
import { EvidenceService } from './evidence.service';
import { EligibilityService } from '../matching/eligibility.service';
import { MatchBlocksController } from '../matching/match-blocks.controller';
import { MatchBlocksService } from '../matching/match-blocks.service';
import { CandidatesService } from '../matching/candidates.service';
import { ERRANDS } from './errands.token';

@Module({
  imports: [ChatModule],
  controllers: [ErrandsController, MatchBlocksController],
  providers: [
    ErrandsService,
    ErrandNotifier,
    EvidenceService,
    EligibilityService,
    MatchBlocksService,
    CandidatesService,
    { provide: ERRANDS, useExisting: ErrandsService },
  ],
  exports: [ErrandsService, EvidenceService, CandidatesService],
})
export class ErrandsModule {}
