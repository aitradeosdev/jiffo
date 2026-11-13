import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, ne, sql } from 'drizzle-orm';
import { ID_TYPES, yearsOld, type IdType } from '@jiffo/shared';
import type { IdentityResult } from '../adapters/identity';
import { conflict, forbidden } from '../common/errors';
import { CountriesService } from '../countries/countries.service';
import { DB, type Db } from '../db/database.module';
import { customerVerifications, users } from '../db/schema';
import {
  ID_CHECK_LABELS,
  IdentityChecksService,
  type Check,
  type IdentityOwner,
  type PendingCheck,
} from './identity-checks.service';

type Verification = typeof customerVerifications.$inferSelect;

/** What the app says about each check, in the customer's words. */
const LABELS: Record<string, string> = {
  ...ID_CHECK_LABELS,
  duplicate: 'No other customer account on this ID',
};
/** While checking, the provider is asked again at most this often, however often the app looks. */
const POLL_EVERY_MS = 15_000;

/**
 * Customers' identity checks, with the provider switched on in the panel: they pick one of the IDs admin
 * accepts, and add money and request errands once verified. Only the result, the legal name, the date of
 * birth and a fingerprint of the ID are kept.
 */
@Injectable()
export class CustomerIdentityService implements IdentityOwner {
  private readonly logger = new Logger(CustomerIdentityService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly checks: IdentityChecksService,
    private readonly countries: CountriesService,
  ) {
    checks.register('customer', this);
  }

  private async load(userId: string): Promise<Verification | null> {
    const [row] = await this.db.select().from(customerVerifications).where(eq(customerVerifications.userId, userId));
    return row ?? null;
  }

  private async user(userId: string) {
    const [user] = await this.db.select().from(users).where(eq(users.id, userId));
    return user!;
  }

  private async settingsFor(userId: string) {
    return (await this.countries.currentSettings((await this.user(userId)).countryCode)).settings;
  }

  /** The customer's check as the app shows it, and what a new one can use. */
  async view(userId: string) {
    let row = await this.load(userId);
    // A check whose result wasn't back when the app last asked: the provider is asked again here.
    if (row?.status === 'checking' && Date.now() - row.updatedAt.getTime() > POLL_EVERY_MS) {
      await this.settle$(row).catch((error: unknown) =>
        this.logger.warn(`Identity check for ${userId} could not be read: ${String(error)}`),
      );
      row = await this.load(userId);
    }
    const settings = await this.settingsFor(userId);
    const options = this.checks.options('customer', settings.identity);
    return {
      /** none, checking, verified, review, failed or declined. */
      status: row?.status ?? 'none',
      idType: row?.idType ?? null,
      legalName: row?.legalName ?? null,
      checks: (row?.checks ?? []).map((c) => ({ ...c, label: LABELS[c.key] ?? c.key })),
      /** Said to the customer only when support declined. */
      decisionNote: row?.status === 'declined' ? row.decisionNote : null,
      /** For a new check: the IDs the customer can use now, and how the check runs. */
      idTypes: options.idTypes.map((key) => ({ key, name: ID_TYPES[key].name })),
      flow: options.flow,
      idChosenOnPage: options.idChosenOnPage,
      provider: options.providerName,
      reviewHours: settings.identity.reviewTargetHours,
    };
  }

  /** Starts a check with the ID the customer chose. Any number goes to the provider and is not kept. */
  async start(userId: string, input: { idType?: string; idNumber?: string }) {
    const row = await this.load(userId);
    if (row?.status === 'verified') throw conflict('already_verified', "You're already verified");
    if (row?.status === 'declined') {
      throw forbidden('identity_declined', 'Our team could not verify your ID. Contact support to talk it through.');
    }
    const user = await this.user(userId);
    if (!user.firstName || !user.lastName) {
      throw conflict('profile_incomplete', 'Add your first and last name, as on your ID, first');
    }
    const settings = await this.settingsFor(userId);
    const started = await this.checks.start(
      'customer',
      { firstName: user.firstName, lastName: user.lastName, phone: user.phone },
      settings.identity,
      input,
    );
    const values = {
      status: 'checking' as const,
      provider: started.provider,
      reference: started.reference,
      idType: started.request.idType,
      outcome: null,
      checks: [],
      legalName: null,
      dateOfBirth: null,
      idFingerprint: null,
      pendingIdFingerprint: started.pendingFingerprint,
      checkedAt: null,
      updatedAt: new Date(),
    };
    await this.db
      .insert(customerVerifications)
      .values({ userId, ...values })
      .onConflictDoUpdate({ target: customerVerifications.userId, set: values });
    return { sdkToken: started.sdkToken, url: started.url, provider: started.provider };
  }

  /** After the provider's screens: the result, once back. */
  async finish(userId: string) {
    const row = await this.load(userId);
    if (!row) throw conflict('identity_not_started', 'Start with your ID');
    if (row.status !== 'checking') return { status: row.status, outcome: row.outcome };
    const settled = await this.settle$(row);
    if (settled) return settled;
    const now = await this.load(userId);
    return { status: now!.status, outcome: now!.outcome };
  }

  private async settle$(row: Verification) {
    const result = await this.checks.result(row);
    if (result.status === 'pending') {
      await this.db
        .update(customerVerifications)
        .set({ updatedAt: new Date() })
        .where(eq(customerVerifications.userId, row.userId));
      return { status: 'checking' as const, outcome: null };
    }
    return this.apply(row, result);
  }

  /** The customer's check waiting on this provider and reference, if any. */
  async waiting(provider: string, reference: string): Promise<PendingCheck | null> {
    const [row] = await this.db
      .select()
      .from(customerVerifications)
      .where(
        and(
          eq(customerVerifications.provider, provider),
          eq(customerVerifications.reference, reference),
          eq(customerVerifications.status, 'checking'),
        ),
      );
    return row
      ? { userId: row.userId, provider, reference, request: { idType: row.idType as IdType, withBvn: false } }
      : null;
  }

  async settle(check: PendingCheck, result: IdentityResult) {
    const row = await this.load(check.userId);
    if (!row || row.reference !== check.reference || row.status !== 'checking') return null;
    return this.apply(row, result);
  }

  /**
   * Keeps a finished result, if the check is still waited on. Verified when every check passed, the customer
   * is 18 or older, and no other customer account holds the ID; a failed check can be tried again; anything
   * else goes to support.
   */
  private async apply(row: Verification, result: IdentityResult) {
    const settings = await this.settingsFor(row.userId);
    const judged = this.checks.judge(
      { idType: row.idType as IdType, withBvn: false },
      result,
      this.checks.accepted('customer', settings.identity, row.provider),
    );
    const fingerprint = judged.fingerprint ?? row.pendingIdFingerprint;
    return this.db.transaction(async (tx) => {
      const checks: Check[] = [...judged.checks];
      checks.push({
        key: 'age',
        ...(judged.dateOfBirth
          ? yearsOld(judged.dateOfBirth) >= 18
            ? { outcome: 'passed' }
            : { outcome: 'failed', note: 'Customers must be 18 or older' }
          : { outcome: 'review', note: 'No date of birth on the ID record' }),
      });
      let claim: string | null = null;
      if (judged.own && fingerprint) {
        // One claim at a time per ID, so two accounts can't both take it at the same moment.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'cid:' + fingerprint}))`);
        const [holder] = await tx
          .select({ userId: customerVerifications.userId })
          .from(customerVerifications)
          .where(
            and(eq(customerVerifications.idFingerprint, fingerprint), ne(customerVerifications.userId, row.userId)),
          );
        if (holder) checks.push({ key: 'duplicate', outcome: 'review', note: 'Another customer account uses this ID' });
        else claim = fingerprint;
      }
      const status = checks.some((c) => c.outcome === 'failed')
        ? 'failed'
        : judged.outcome === 'passed' && claim && checks.every((c) => c.outcome === 'passed')
          ? 'verified'
          : 'review';
      const [updated] = await tx
        .update(customerVerifications)
        .set({
          status,
          outcome: judged.outcome,
          idType: judged.idType,
          checks,
          legalName: judged.legalName,
          dateOfBirth: judged.dateOfBirth,
          // Held only once verified; otherwise it waits, so support's approval can claim it.
          idFingerprint: status === 'verified' ? claim : null,
          pendingIdFingerprint: status === 'verified' ? null : fingerprint,
          checkedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(customerVerifications.userId, row.userId),
            eq(customerVerifications.reference, row.reference),
            eq(customerVerifications.status, 'checking'),
          ),
        )
        .returning({ status: customerVerifications.status });
      return updated ? { status: updated.status, outcome: judged.outcome } : null;
    });
  }

  /** Whether the customer may add money and request errands. */
  async verified(userId: string) {
    return (await this.load(userId))?.status === 'verified';
  }

  async assertVerified(userId: string) {
    if (!(await this.verified(userId))) {
      throw forbidden('identity_required', 'Verify your ID first. It takes a couple of minutes.');
    }
  }
}
