import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  DEFAULT_RISK_SETTINGS,
  SIGN_IN_RISK_INFO,
  SIGN_IN_RISKS,
  type RiskSignal,
  type SignInRisk,
} from '@jiffo/shared';
import { CountriesService } from '../countries/countries.service';
import { DB, type Db } from '../db/database.module';
import { devices } from '../db/schema';
import { CloudRangesService } from './cloud-ranges.service';

/** How far back other accounts' sign-ins on the same phone count. */
const SHARED_PHONE_DAYS = 90;
const FROM_THE_APP: readonly SignInRisk[] = ['emulator', 'rooted', 'hooking', 'debugger'];

export interface SignInAssessment {
  score: number;
  reasons: SignInRisk[];
  /** Above the country's step-up score: more checks are asked for. */
  stepUp: boolean;
  details: { accounts?: number; provider?: string };
}

/**
 * How risky a sign-up or sign-in looks (docs/security-plan.md, A10), from what the app found on the phone, how
 * many accounts have used the phone, a VPN, and an address in a cloud provider's published ranges. Each adds
 * its points; a score at the country's step-up level asks for more checks. It never refuses a sign-in.
 */
@Injectable()
export class SignInRiskService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly countries: CountriesService,
    private readonly cloud: CloudRangesService,
  ) {}

  async assess(input: {
    countryCode: string;
    app: string;
    /** The account, if it already exists. */
    userId: string | null;
    deviceKey: string;
    phoneFingerprint: string | null;
    signals: readonly RiskSignal[];
    /** What the app said the connection is: wifi, cellular, ethernet, vpn. */
    network: string | undefined;
    ip: string | null;
  }): Promise<SignInAssessment> {
    const settings = await this.settings(input.countryCode);
    const found = new Set<SignInRisk>(FROM_THE_APP.filter((r) => input.signals.includes(r as RiskSignal)));
    const details: SignInAssessment['details'] = {};

    const [accounts, provider] = await Promise.all([this.accountsOnPhone(input), this.cloud.providerOf(input.ip)]);
    if (accounts >= settings.signInRiskAccounts) {
      found.add('shared_phone');
      details.accounts = accounts;
    }
    if (input.network === 'vpn') found.add('vpn');
    if (provider) {
      found.add('data_centre');
      details.provider = provider;
    }

    const reasons = SIGN_IN_RISKS.filter((r) => found.has(r));
    const score = reasons.reduce((sum, r) => sum + SIGN_IN_RISK_INFO[r].points, 0);
    return { score, reasons, stepUp: score >= settings.signInRiskStepUpAt, details };
  }

  /**
   * The accounts that have signed in on this phone in the last 90 days, this one included: by the phone's own
   * id, the same in both apps, or this install of the app.
   */
  private async accountsOnPhone(input: {
    userId: string | null;
    deviceKey: string;
    app: string;
    phoneFingerprint: string | null;
  }) {
    const { rows } = await this.db.execute<{ n: number }>(sql`
      select count(distinct user_id)::int as n from ${devices}
      where last_seen_at > now() - make_interval(days => ${SHARED_PHONE_DAYS})
        and (${input.userId}::uuid is null or user_id <> ${input.userId}::uuid)
        and ((device_key = ${input.deviceKey} and app = ${input.app})
          ${input.phoneFingerprint ? sql`or phone_fingerprint = ${input.phoneFingerprint}` : sql``})`);
    return (rows[0]?.n ?? 0) + 1;
  }

  /** The country's Risk settings, or the defaults when it has none or its stored version can't be read. */
  private async settings(countryCode: string) {
    try {
      return (await this.countries.currentSettingsIfAny(countryCode))?.settings.risk ?? DEFAULT_RISK_SETTINGS;
    } catch (error) {
      if (error instanceof Error && error.name === 'ZodError') return DEFAULT_RISK_SETTINGS;
      throw error;
    }
  }
}
