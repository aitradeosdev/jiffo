import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { AgentTier } from '@jiffo/shared';
import { DB, type Db } from '../db/database.module';
import { AGENT_PROFILE_DEFAULTS, agentProfiles, users } from '../db/schema';
import { CountriesService } from '../countries/countries.service';
import type { AuthContext } from '../auth/auth.types';
import { unprocessable } from '../common/errors';

export interface AgentProfile {
  tier: AgentTier;
  /** null receives every category. */
  categoryKeys: string[] | null;
  takesPurchases: boolean;
}

/** Agent-only details. An agent with no row yet simply has the defaults. */
@Injectable()
export class AgentsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly countries: CountriesService,
  ) {}

  private async stored(userId: string): Promise<AgentProfile> {
    const [row] = await this.db
      .select({
        tier: agentProfiles.tier,
        categoryKeys: agentProfiles.categoryKeys,
        takesPurchases: agentProfiles.takesPurchases,
      })
      .from(agentProfiles)
      .where(eq(agentProfiles.userId, userId));
    return row ?? { ...AGENT_PROFILE_DEFAULTS };
  }

  /** The tier admin set for the agent. Agents with no profile yet are Bronze, which covers new agents. */
  async tier(userId: string): Promise<AgentTier> {
    return (await this.stored(userId)).tier;
  }

  /**
   * The agent's profile with only categories that are still active. If admin has switched off every
   * category the agent chose, they receive every category rather than an empty board.
   */
  async profile(userId: string): Promise<AgentProfile> {
    const profile = await this.stored(userId);
    if (!profile.categoryKeys) return profile;
    const [user] = await this.db.select({ countryCode: users.countryCode }).from(users).where(eq(users.id, userId));
    const active = new Set((await this.countries.activeCategories(user!.countryCode)).map((c) => c.key));
    const live = profile.categoryKeys.filter((k) => active.has(k));
    return { ...profile, categoryKeys: live.length > 0 ? live : null };
  }

  /** The agent chooses their categories and whether they take purchase errands. The tier is admin's. */
  async updatePreferences(auth: AuthContext, input: Partial<Omit<AgentProfile, 'tier'>>) {
    if (input.categoryKeys) {
      const active = new Set((await this.countries.activeCategories(auth.countryCode)).map((c) => c.key));
      const unknown = input.categoryKeys.filter((k) => !active.has(k));
      if (unknown.length > 0)
        throw unprocessable('category_not_available', 'Choose categories from the list', { unknown });
    }
    const changes = {
      ...(input.categoryKeys !== undefined
        ? { categoryKeys: input.categoryKeys && [...new Set(input.categoryKeys)] }
        : {}),
      ...(input.takesPurchases !== undefined ? { takesPurchases: input.takesPurchases } : {}),
    };
    await this.db
      .insert(agentProfiles)
      .values({ userId: auth.userId, ...changes })
      .onConflictDoUpdate({ target: agentProfiles.userId, set: { ...changes, updatedAt: new Date() } });
    return this.profile(auth.userId);
  }
}
