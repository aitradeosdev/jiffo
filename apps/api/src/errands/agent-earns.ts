import { commissionBpsFor, splitFeeEscrow, type AgentTier } from '@jiffo/shared';
import type { CountriesService } from '../countries/countries.service';
import type { errands } from '../db/schema';

/**
 * What an agent at this tier earns from the errand, by the settings it was priced under: the fee less Jiffo's
 * commission. As the board, the errand and an offer show it to them.
 */
export async function agentEarnsKobo(
  countries: CountriesService,
  errand: typeof errands.$inferSelect,
  tier: AgentTier,
): Promise<number> {
  const settings = await countries.errandSettings(errand);
  return splitFeeEscrow({
    feeKobo: errand.feeKobo,
    serviceFeeKobo: errand.serviceFeeKobo,
    commissionBps: commissionBpsFor(settings.fees, tier),
  }).agentKobo;
}
