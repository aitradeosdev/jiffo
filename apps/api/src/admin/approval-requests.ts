import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { and, count, eq } from 'drizzle-orm';
import {
  ADMIN_ROLE_INFO,
  formatNaira,
  providerInfo,
  PROVIDER_CATEGORY_INFO,
  type AdminRole,
  type ProviderCategory,
} from '@jiffo/shared';
import { conflict, forbidden, notFound } from '../common/errors';
import { CountriesService } from '../countries/countries.service';
import { DB, type Db } from '../db/database.module';
import { admins, errands, users } from '../db/schema';
import type { AdminErrandEvent } from '../errands/errands.service';
import type { DisputeSplit } from '../money/wallet.service';
import { ApprovalsService, securityOf } from './approvals.service';
import type { AdminContext } from './admin.types';
import { ErrandsAdminService } from './errands-admin.service';
import { MoneyAdminService, type AdjustmentInput } from './money-admin.service';
import { normaliseEmail } from './admin-auth.service';
import { PeopleAdminService } from './people-admin.service';
import { ProvidersAdminService } from './providers-admin.service';
import { SettingsAdminService } from './settings-admin.service';
import { TeamService } from './team.service';

const ACCOUNT_LABEL = { customer_wallet: 'customer wallet', agent_available: 'agent balance' } as const;
const nameOf = (u: { firstName: string | null; lastName: string | null; phone: string }) =>
  [u.firstName, u.lastName].filter(Boolean).join(' ') || u.phone;
const ref = (id: string) => id.slice(0, 8).toUpperCase();

type ErrandAction = { event: AdminErrandEvent; version: number; note: string; split?: DisputeSplit };
type ProviderSave = { config: Record<string, string>; secrets: Record<string, string> };

/**
 * The changes that need a second admin (docs/security-plan.md, D4, E7, X7): each is checked as far as it can
 * be before it waits, described for the person deciding, and run as the person who asked once approved.
 * Everything else an admin does runs at once, as before.
 */
@Injectable()
export class ApprovalRequests implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly approvals: ApprovalsService,
    private readonly countries: CountriesService,
    private readonly money: MoneyAdminService,
    private readonly errands: ErrandsAdminService,
    private readonly settings: SettingsAdminService,
    private readonly team: TeamService,
    private readonly people: PeopleAdminService,
    private readonly providers: ProvidersAdminService,
  ) {}

  onModuleInit() {
    const run = this.approvals.register.bind(this.approvals);
    run('wallet_adjustment', (as, p) => this.money.adjust(as, p as unknown as AdjustmentInput));
    run('dispute_split', (as, p) => this.errands.act(as, p.errandId as string, p.action as ErrandAction));
    run('settings_change', (as, p) =>
      this.settings.saveSettings(as, p.code as string, p.input as { basedOn: number; settings: unknown; note: string }),
    );
    run('team_invite', (as, p) => this.team.invite(as, p as { email: string; name: string; role: AdminRole }));
    run('team_change', (as, p) =>
      this.team.update(as, p.id as string, p.change as { role?: AdminRole; status?: 'active' | 'disabled' }),
    );
    run('agent_suspend', (as, p) => this.people.suspend(as, p.id as string, p.note as string));
    run('provider_change', (as, p) =>
      p.action === 'switch'
        ? this.providers.activate(
            as,
            p.category as ProviderCategory,
            p.provider as string | null,
            p.settingsAt as string | null,
          )
        : this.providers.applyPending(
            as,
            p as { category: ProviderCategory; provider: string; sealed: string; basedOn: string },
          ),
    );
  }

  /** Every wallet adjustment and refund (D4). */
  async adjustment(admin: AdminContext, input: AdjustmentInput) {
    const person = await this.money.checkAdjustment(input);
    const amount = formatNaira(input.amountKobo);
    const summary =
      input.direction === 'credit'
        ? `Credit ${amount} to ${nameOf(person)}'s ${ACCOUNT_LABEL[input.account]}`
        : `Take ${amount} from ${nameOf(person)}'s ${ACCOUNT_LABEL[input.account]}`;
    return this.approvals.submit(admin, {
      kind: 'wallet_adjustment',
      payload: { ...input },
      summary,
      note: input.note,
      countryCode: person.countryCode,
      targetType: 'person',
      targetId: person.id,
    });
  }

  /** A dispute split paying the agent more than the set amount (D4, E7); anything smaller runs at once. */
  async errandAction(admin: AdminContext, errandId: string, action: ErrandAction) {
    if (action.split) {
      const [errand] = await this.db.select().from(errands).where(eq(errands.id, errandId));
      if (!errand) throw notFound('errand_not_found', 'Errand not found');
      const limit = (await securityOf(this.countries, errand.countryCode)).disputeSplitApprovalKobo;
      const toAgent = action.split.agentKobo + action.split.itemsToAgentKobo + action.split.chargeCustomerKobo;
      if (limit === 0 || toAgent > limit) {
        return this.approvals.submit(admin, {
          kind: 'dispute_split',
          payload: { errandId, action: { ...action } },
          summary: `Settle errand ${ref(errandId)} by splitting the money: ${formatNaira(toAgent)} to the agent, ${formatNaira(action.split.jiffoKobo)} kept by Jiffo, the rest back to the customer`,
          note: action.note,
          countryCode: errand.countryCode,
          targetType: 'errand',
          targetId: errandId,
        });
      }
    }
    return this.errands.act(admin, errandId, action);
  }

  /** Every change to fees, timers, limits and the rest of a country's settings (D4, X10). */
  async settingsChange(admin: AdminContext, code: string, input: { basedOn: number; settings: unknown; note: string }) {
    const { changes, version } = await this.settings.settingsRequest(code, input);
    if (changes.length === 0) return { version, changes };
    const named = changes.map((c) => c.path);
    return this.approvals.submit(admin, {
      kind: 'settings_change',
      payload: { code, input: { ...input } },
      summary: `Change ${named.length} setting${named.length === 1 ? '' : 's'} for ${code}: ${named.slice(0, 6).join(', ')}${named.length > 6 ? ', and more' : ''}`,
      note: input.note,
      countryCode: code,
      targetType: 'settings',
      targetId: code,
    });
  }

  /** A new teammate is a new role given out (D4). */
  async invite(admin: AdminContext, input: { email: string; name: string; role: AdminRole }) {
    const email = normaliseEmail(input.email);
    const [existing] = await this.db.select({ id: admins.id }).from(admins).where(eq(admins.email, email));
    if (existing) throw conflict('admin_exists', 'Someone on the team already uses this email');
    return this.approvals.submit(admin, {
      kind: 'team_invite',
      payload: { ...input, email },
      summary: `Add ${email} to the team as ${ADMIN_ROLE_INFO[input.role].label}`,
      note: `Invite ${input.name.trim()}`,
      targetType: 'admin',
      targetId: email,
    });
  }

  /**
   * A role change, or giving a disabled teammate their access back (D4). Disabling someone takes access
   * away, so it runs at once.
   */
  async teamChange(admin: AdminContext, id: string, change: { role?: AdminRole; status?: 'active' | 'disabled' }) {
    if (id === admin.adminId) throw forbidden('own_account', "You can't change your own access. Ask another owner.");
    const [target] = await this.db.select().from(admins).where(eq(admins.id, id));
    if (!target) throw notFound('admin_not_found', 'Teammate not found');
    const newRole = change.role && change.role !== target.role ? change.role : null;
    const reEnabled = change.status === 'active' && target.status === 'disabled';
    if (!newRole && !reEnabled) return this.team.update(admin, id, change);
    const what = [
      newRole ? `make them ${ADMIN_ROLE_INFO[newRole].label}` : null,
      reEnabled ? 'give their access back' : null,
    ].filter(Boolean);
    return this.approvals.submit(admin, {
      kind: 'team_change',
      payload: { id, change: { ...change } },
      summary: `${target.name} (${target.email}): ${what.join(' and ')}`,
      note: what.join(' and '),
      targetType: 'admin',
      targetId: id,
    });
  }

  /** Suspending an agent who has done many errands (D4); anyone else is suspended at once. */
  async suspend(admin: AdminContext, id: string, note: string) {
    const [person] = await this.db.select().from(users).where(eq(users.id, id));
    if (!person) throw notFound('person_not_found', 'Person not found');
    const [done] = await this.db
      .select({ n: count() })
      .from(errands)
      .where(and(eq(errands.agentId, id), eq(errands.status, 'completed')));
    const busy = (await securityOf(this.countries, person.countryCode)).busyAgentErrands;
    const completed = done?.n ?? 0;
    if (completed < busy) return this.people.suspend(admin, id, note);
    return this.approvals.submit(admin, {
      kind: 'agent_suspend',
      payload: { id, note },
      summary: `Suspend ${nameOf(person)}, an agent with ${completed} completed errands`,
      note,
      countryCode: person.countryCode,
      targetType: 'person',
      targetId: id,
    });
  }

  /** Switching which provider a service uses, or back to the server's choice. */
  async providerSwitch(admin: AdminContext, category: ProviderCategory, provider: string | null) {
    const { from, settingsAt } = await this.providers.switchRequest(category, provider);
    if (from === provider) return { active: provider };
    const label = PROVIDER_CATEGORY_INFO[category].label;
    const name = (key: string | null) => (key ? (providerInfo(category, key)?.name ?? key) : "the server's choice");
    return this.approvals.submit(admin, {
      kind: 'provider_change',
      payload: { action: 'switch', category, provider, settingsAt },
      summary: `${label}: switch from ${name(from)} to ${name(provider)}`,
      note: `Switch ${label.toLowerCase()} provider`,
      targetType: 'provider',
      targetId: `${category}:${provider ?? 'none'}`,
    });
  }

  /** Saving settings: at once for a provider not in use, after approval for the one in use. */
  async providerSave(admin: AdminContext, category: ProviderCategory, provider: string, input: ProviderSave) {
    const saved = await this.providers.save(admin, category, provider, input);
    if (!('approval' in saved) || !saved.approval) return saved;
    const info = providerInfo(category, provider);
    const fields = saved.changed.map((k) => info?.fields.find((f) => f.key === k)?.label ?? k);
    return this.approvals.submit(admin, {
      kind: 'provider_change',
      payload: { action: 'save', category, provider, ...saved.approval },
      summary: `Change ${info?.name ?? provider}'s settings while it's in use: ${fields.join(', ')}`,
      note: `Change ${info?.name ?? provider} settings`,
      targetType: 'provider',
      targetId: `${category}:${provider}`,
    });
  }
}
