import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, gt, lt, sql } from 'drizzle-orm';
import { fitAcceptance, logLoss, type AcceptanceModel, type OfferFeatures } from '@jiffo/shared';
import { CountriesService } from '../countries/countries.service';
import { DB, type Db } from '../db/database.module';
import { acceptanceModels, countries } from '../db/schema';

/** The answered offers a model learns from: those of the last this many days. */
const LOOK_BACK_DAYS = 60;
/** At most this many, the newest, per state: enough for a few inputs, and quick to fit. */
const MAX_OFFERS = 5_000;
/** Models are kept this long, for looking back on, then let go. */
const KEEP_DAYS = 30;
/** A model is used for ranking while it is this many days old or less: one not refitted since stops counting. */
export const MODEL_FRESH_DAYS = 7;

/**
 * Acceptance prediction (docs/matching.md, M13), as DoorDash ranks with it: nightly, each state with enough answered
 * offers lately (Settings, Matching) gets a model of who takes what, from what each offer looked like to the agent
 * when it was made. Ranking takes the newest, while it is fresh.
 */
@Injectable()
export class PredictionService {
  private readonly logger = new Logger('Prediction');

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly countries: CountriesService,
  ) {}

  /** The model to rank a state's offers with: its newest, if a week old or less. */
  async modelFor(countryCode: string, stateCode: string): Promise<AcceptanceModel | null> {
    const [row] = await this.db
      .select({ model: acceptanceModels.model })
      .from(acceptanceModels)
      .where(
        and(
          eq(acceptanceModels.countryCode, countryCode),
          eq(acceptanceModels.stateCode, stateCode),
          gt(acceptanceModels.trainedAt, new Date(Date.now() - MODEL_FRESH_DAYS * 86_400_000)),
        ),
      )
      .orderBy(desc(acceptanceModels.trainedAt))
      .limit(1);
    return row?.model ?? null;
  }

  /**
   * Nightly: a new model for each state whose answered offers of late reach the Matching settings' number. Offers
   * made back to back are left out, as the agent was busy when they rang; so are offers from before features were
   * kept. A country whose prediction share is 0 is left alone. Models over a month old are let go.
   */
  async fitAll() {
    await this.db
      .delete(acceptanceModels)
      .where(lt(acceptanceModels.trainedAt, new Date(Date.now() - KEEP_DAYS * 86_400_000)));
    let fitted = 0;
    for (const { code } of await this.db.select({ code: countries.code }).from(countries)) {
      try {
        fitted += await this.fitCountry(code);
      } catch (error) {
        this.logger.error(`Fitting ${code}'s models failed: ${(error as Error).message}`);
      }
    }
    return { fitted };
  }

  private async fitCountry(code: string) {
    const current = await this.countries.currentSettingsIfAny(code);
    if (!current || current.settings.matching.predictionShareBps <= 0) return 0;
    const min = current.settings.matching.predictionMinOffers;
    const since = new Date(Date.now() - LOOK_BACK_DAYS * 86_400_000);
    const { rows: states } = await this.db.execute<{ state_code: string; n: number }>(sql`
      select e.state_code, count(*)::int as n
      from errand_offers o join errands e on e.id = o.errand_id
      where o.country_code = ${code} and o.features is not null and not o.back_to_back
        and o.status in ('accepted', 'declined', 'expired') and o.offered_at > ${since}
      group by e.state_code
      having count(*) >= ${min}`);
    let fitted = 0;
    for (const state of states) {
      try {
        const { rows } = await this.db.execute<{ features: OfferFeatures; status: string }>(sql`
          select o.features, o.status
          from errand_offers o join errands e on e.id = o.errand_id
          where o.country_code = ${code} and e.state_code = ${state.state_code} and o.features is not null
            and not o.back_to_back and o.status in ('accepted', 'declined', 'expired') and o.offered_at > ${since}
          order by o.offered_at desc
          limit ${MAX_OFFERS}`);
        const history = rows.map((r) => ({ features: r.features, accepted: r.status === 'accepted' }));
        const model = fitAcceptance(history);
        await this.db.insert(acceptanceModels).values({
          countryCode: code,
          stateCode: state.state_code,
          model,
          offers: history.length,
          logLoss: logLoss(model, history),
        });
        fitted++;
      } catch (error) {
        this.logger.error(`Fitting ${code}-${state.state_code}'s model failed: ${(error as Error).message}`);
      }
      // Each fit runs on the event loop: let requests through between states.
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    return fitted;
  }

  /** Each state's newest model, for the dashboard: whether it's in use, and how it learnt. */
  async latest(countryCode: string) {
    const { rows } = await this.db.execute<{
      state_code: string;
      offers: number;
      log_loss: number;
      trained_at: Date;
    }>(sql`
      select distinct on (state_code) state_code, offers, log_loss, trained_at
      from acceptance_models where country_code = ${countryCode}
      order by state_code, trained_at desc`);
    const fresh = Date.now() - MODEL_FRESH_DAYS * 86_400_000;
    // With the share at 0, ranking leaves every model alone.
    const on =
      ((await this.countries.currentSettingsIfAny(countryCode))?.settings.matching.predictionShareBps ?? 0) > 0;
    return rows.map((r) => ({
      stateCode: r.state_code,
      offers: r.offers,
      logLoss: r.log_loss,
      trainedAt: r.trained_at,
      inUse: on && new Date(r.trained_at).getTime() > fresh,
    }));
  }
}
