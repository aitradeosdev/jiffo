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
import { RankingService } from '../matching/ranking.service';
import { OffersController } from '../matching/offers.controller';
import { OffersService } from '../matching/offers.service';
import { ERRANDS } from './errands.token';

@Module({
  imports: [ChatModule],
  controllers: [ErrandsController, MatchBlocksController, OffersController],
  providers: [
    ErrandsService,
    ErrandNotifier,
    EvidenceService,
    EligibilityService,
    MatchBlocksService,
    CandidatesService,
    RankingService,
    OffersService,
    { provide: ERRANDS, useExisting: ErrandsService },
  ],
  exports: [ErrandsService, EvidenceService, CandidatesService, RankingService],
})
export class ErrandsModule {}
