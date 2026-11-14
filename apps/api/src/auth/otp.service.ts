import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, gt, sql } from 'drizzle-orm';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { DB, type Db } from '../db/database.module';
import { otpChallenges } from '../db/schema';
import { CountriesService } from '../countries/countries.service';
import { MESSAGING, type MessagingAdapter } from '../adapters/messaging';
import { hmacSha256, numericCode, safeEqual } from '../common/crypto';
import { badRequest, tooMany } from '../common/errors';
import { AlertsService } from '../alerts/alerts.service';

const QUARTER_MS = 15 * 60_000;
const DAY_MS = 86_400_000;

/**
 * One-time sign-in codes: 6 digits, stored only as an HMAC, short-lived, and limited per number, per phone
 * and per network address (docs/security-plan.md, A1).
 */
@Injectable()
export class OtpService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(MESSAGING) private readonly messaging: MessagingAdapter,
    private readonly countries: CountriesService,
    private readonly alerts: AlertsService,
  ) {}

  private hash(phone: string, code: string) {
    return hmacSha256(this.config.OTP_SECRET, `${phone}:${code}`);
  }

  async request(phone: string, country: string, ip: string | null, deviceKey: string | null = null) {
    const { settings } = await this.countries.currentSettings(country);
    const { limits } = settings;
    const code = numericCode(6);
    const now = Date.now();
    const since = (ms: number) => new Date(now - ms);
    const tooManyCodes = () =>
      tooMany('otp_rate_limited', 'Too many codes asked for. Try again later.', { retryAfterSeconds: 900 });

    const challengeId = await this.db.transaction(async (tx) => {
      // One request at a time per number, per phone and per network address, so a burst can't slip past
      // any of the counts. Always taken in this order, so two requests never wait on each other.
      for (const key of [`otp:${phone}`, deviceKey && `otp-device:${deviceKey}`, ip && `otp-ip:${ip}`]) {
        if (key) await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`);
      }

      const [latest] = await tx
        .select({ createdAt: otpChallenges.createdAt })
        .from(otpChallenges)
        .where(eq(otpChallenges.phone, phone))
        .orderBy(desc(otpChallenges.createdAt))
        .limit(1);
      if (latest) {
        const waitMs = latest.createdAt.getTime() + limits.otpResendSeconds * 1000 - now;
        if (waitMs > 0) {
          throw tooMany('otp_resend_wait', 'Wait a moment before asking for another code', {
            retryAfterSeconds: Math.ceil(waitMs / 1000),
          });
        }
      }

      /** Codes asked for by one number, phone or address, in the last 15 minutes and the last day. */
      const counted = async (
        column: typeof otpChallenges.phone | typeof otpChallenges.deviceKey | typeof otpChallenges.requestedIp,
        value: string,
      ) => {
        const [row] = await tx
          .select({
            quarter: sql<number>`count(*) filter (where ${otpChallenges.createdAt} > ${since(QUARTER_MS)})::int`,
            day: count(),
          })
          .from(otpChallenges)
          .where(and(eq(column, value), gt(otpChallenges.createdAt, since(DAY_MS))));
        return { quarter: row?.quarter ?? 0, day: row?.day ?? 0 };
      };
      for (const [column, value] of [
        [otpChallenges.phone, phone],
        [otpChallenges.deviceKey, deviceKey],
      ] as const) {
        if (!value) continue;
        const made = await counted(column, value);
        if (made.quarter >= limits.otpPerQuarterHour || made.day >= limits.otpPerDay) throw tooManyCodes();
      }
      // A network address can be shared by many customers on a mobile network, so its limits are higher.
      if (ip) {
        const made = await counted(otpChallenges.requestedIp, ip);
        const [hour] = await tx
          .select({ n: count() })
          .from(otpChallenges)
          .where(and(eq(otpChallenges.requestedIp, ip), gt(otpChallenges.createdAt, since(DAY_MS / 24))));
        if ((hour?.n ?? 0) >= this.config.OTP_PER_IP_PER_HOUR || made.day >= this.config.OTP_PER_IP_PER_DAY) {
          throw tooManyCodes();
        }
      }

      const [row] = await tx
        .insert(otpChallenges)
        .values({
          phone,
          countryCode: country,
          codeHash: this.hash(phone, code),
          requestedIp: ip,
          deviceKey,
          expiresAt: new Date(now + limits.otpTtlSeconds * 1000),
        })
        .returning({ id: otpChallenges.id });
      return row!.id;
    });

    try {
      await this.messaging.sendOtp(phone, code, limits.otpTtlSeconds);
    } catch (error) {
      // The code never reached the person, so it must not count against them.
      await this.db.delete(otpChallenges).where(eq(otpChallenges.id, challengeId));
      throw error;
    }
    await this.watchSpend(country, settings.security.smsCodesDailyAlert);
    return { expiresInSeconds: limits.otpTtlSeconds, resendInSeconds: limits.otpResendSeconds };
  }

  /**
   * Each code is a paid SMS: once the codes sent in the country in the last day pass the set level, finance
   * hears of it, once a day (docs/security-plan.md, A2). A sudden rise can mean someone is sending codes to
   * numbers they found, at Jiffo's cost.
   */
  private async watchSpend(country: string, level: number) {
    const [sent] = await this.db
      .select({ n: count() })
      .from(otpChallenges)
      .where(and(eq(otpChallenges.countryCode, country), gt(otpChallenges.createdAt, new Date(Date.now() - DAY_MS))));
    if ((sent?.n ?? 0) < level) return;
    await this.alerts
      .raise({
        countryCode: country,
        kind: 'sms_spend',
        dedupeKey: new Date().toISOString().slice(0, 10),
        message: `${sent!.n} sign-in codes were sent in the last day, above the alert level of ${level}. Each is a paid SMS.`,
        data: { sent: sent!.n, level },
      })
      .catch(() => undefined);
  }

  /** Consumes the latest code for the number, or throws. Only the most recent code is ever accepted. */
  async verify(phone: string, country: string, code: string): Promise<void> {
    const { limits } = (await this.countries.currentSettings(country)).settings;

    const outcome = await this.db.transaction(async (tx) => {
      const [challenge] = await tx
        .select()
        .from(otpChallenges)
        .where(eq(otpChallenges.phone, phone))
        .orderBy(desc(otpChallenges.createdAt))
        .limit(1)
        .for('update');
      if (!challenge || challenge.consumedAt || challenge.expiresAt.getTime() <= Date.now()) {
        return { ok: false as const, reason: 'expired' as const };
      }
      if (challenge.attempts >= limits.otpAttempts) return { ok: false as const, reason: 'locked' as const };

      if (!safeEqual(challenge.codeHash, this.hash(phone, code))) {
        const attempts = challenge.attempts + 1;
        await tx.update(otpChallenges).set({ attempts }).where(eq(otpChallenges.id, challenge.id));
        return {
          ok: false as const,
          reason: 'wrong' as const,
          attemptsLeft: Math.max(0, limits.otpAttempts - attempts),
        };
      }
      await tx.update(otpChallenges).set({ consumedAt: new Date() }).where(eq(otpChallenges.id, challenge.id));
      return { ok: true as const };
    });

    if (outcome.ok) return;
    if (outcome.reason === 'expired') throw badRequest('otp_expired', 'This code has expired. Ask for a new one.');
    if (outcome.reason === 'locked') throw tooMany('otp_attempts_exceeded', 'Too many wrong codes. Ask for a new one.');
    throw badRequest('otp_invalid', 'That code is not right', { attemptsLeft: outcome.attemptsLeft });
  }
}
