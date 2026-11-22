import { Inject, Module, OnModuleInit } from '@nestjs/common';
import { RECURRING_JOBS, type RecurringJobs } from '../timers/recurring-jobs';
import { ChatModule } from '../chat/chat.module';
import { ErrandNotifier } from './errand-notifier';
import { ErrandsController } from './errands.controller';
import { ErrandsService } from './errands.service';
import { EvidenceService } from './evidence.service';
import { EligibilityService } from '../matching/eligibility.service';
import { MatchBlocksController } from '../matching/match-blocks.controller';
import { MatchBlocksService } from '../matching/match-blocks.service';
import { CandidatesService } from '../matching/candidates.service';
import { PredictionService } from '../matching/prediction.service';
import { RankingService } from '../matching/ranking.service';
import { OffersController, StandingController } from '../matching/offers.controller';
import { OffersService } from '../matching/offers.service';
import { ERRANDS } from './errands.token';

@Module({
  imports: [ChatModule],
  controllers: [ErrandsController, MatchBlocksController, OffersController, StandingController],
  providers: [
    ErrandsService,
    ErrandNotifier,
    EvidenceService,
    EligibilityService,
    MatchBlocksService,
    CandidatesService,
    RankingService,
    PredictionService,
    OffersService,
    { provide: ERRANDS, useExisting: ErrandsService },
  ],
  exports: [ErrandsService, EvidenceService, CandidatesService, RankingService, PredictionService],
})
export class ErrandsModule implements OnModuleInit {
  constructor(
    @Inject(RECURRING_JOBS) private readonly jobs: RecurringJobs,
    private readonly offers: OffersService,
    private readonly prediction: PredictionService,
  ) {}

  onModuleInit() {
    // Every minute, end offers whose timer was lost, and look again at urgent errands left with none (M6).
    this.jobs.register('offers.sweep', '* * * * *', () => this.offers.sweep());
    // Nightly, a model of who takes what for each state with enough answered offers (M13).
    this.jobs.register('acceptance.fit', '37 2 * * *', () => this.prediction.fitAll());
  }
}
