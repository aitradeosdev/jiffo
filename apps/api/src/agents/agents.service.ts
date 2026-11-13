import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { AgentTier } from '@jiffo/shared';
import { DB, type Db } from '../db/database.module';
import { agentProfiles } from '../db/schema';
import { CountriesService } from '../countries/countries.service';
import type { AuthContext } from '../auth/auth.types';
import { unprocessable } from '../common/errors';

export interface AgentPreferences {
  categoryKeys: string[] | null;
  takesPurchases: boolean;
}

const profileView = (p: typeof agentProfiles.$inferSelect) => ({
  tier: p.tier,
  categoryKeys: p.categoryKeys,
  takesPurchases: p.takesPurchases,
});

@Injectable()
export class AgentsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly countries: CountriesService,
  ) {}

  private async ensure(userId: string) {
    await this.db.insert(agentProfiles).values({ userId }).onConflictDoNothing();
    const [row] = await this.db.select().from(agentProfiles).where(eq(agentProfiles.userId, userId));
    return row!;
  }

  /** The tier admin set for the agent. Agents with no profile yet are Bronze, which covers new agents. */
  async tier(userId: string): Promise<AgentTier> {
    const [row] = await this.db
      .select({ tier: agentProfiles.tier })
      .from(agentProfiles)
      .where(eq(agentProfiles.userId, userId));
    return row?.tier ?? 'bronze';
  }

  /** What the board should show this agent: null categories means all of them. */
  async preferences(userId: string): Promise<AgentPreferences> {
    const [row] = await this.db
      .select({ categoryKeys: agentProfiles.categoryKeys, takesPurchases: agentProfiles.takesPurchases })
      .from(agentProfiles)
      .where(eq(agentProfiles.userId, userId));
    return row ?? { categoryKeys: null, takesPurchases: true };
  }

  async getProfile(auth: AuthContext) {
    return profileView(await this.ensure(auth.userId));
  }

  /** The agent chooses their categories and whether they take purchase errands. The tier is admin's. */
  async updatePreferences(auth: AuthContext, input: Partial<AgentPreferences>) {
    if (input.categoryKeys) {
      const active = new Set((await this.countries.activeCategories(auth.countryCode)).map((c) => c.key));
      const unknown = input.categoryKeys.filter((k) => !active.has(k));
      if (unknown.length > 0)
        throw unprocessable('category_not_available', 'Choose categories from the list', { unknown });
    }
    await this.ensure(auth.userId);
    const [row] = await this.db
      .update(agentProfiles)
      .set({
        ...(input.categoryKeys !== undefined
          ? { categoryKeys: input.categoryKeys && [...new Set(input.categoryKeys)] }
          : {}),
        ...(input.takesPurchases !== undefined ? { takesPurchases: input.takesPurchases } : {}),
        updatedAt: new Date(),
      })
      .where(eq(agentProfiles.userId, auth.userId))
      .returning();
    return profileView(row!);
  }
}
