import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, gt, sql } from 'drizzle-orm';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { DB, type Db } from '../db/database.module';
import { devices, otpChallenges, users } from '../db/schema';
import { CountriesService } from '../countries/countries.service';
import { MESSAGING, type MessagingAdapter } from '../adapters/messaging';
import { hmacSha256, numericCode, safeEqual } from '../common/crypto';
import { badRequest, tooMany } from '../common/errors';
import { AlertsService } from '../alerts/alerts.service';

const QUARTER_MS = 15 * 60_000;
const HOUR_MS = 3_600_000;
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
    const { limits } = (await this.countries.currentSettings(country)).settings;
    const code = numericCode(6);
    const now = Date.now();
    const since = (ms: number) => new Date(now - ms);
    const limited = (retryAfterSeconds: number) =>
      tooMany(
        'otp_rate_limited',
        retryAfterSeconds > 3_600
          ? 'Too many codes asked for today. Try again tomorrow.'
          : 'Too many codes asked for. Try again later.',
        { retryAfterSeconds },
      );

    const challengeId = await this.db.transaction(async (tx) => {
      // One request at a time per number, per phone and per network address, so a burst can't slip past
      // any of the counts. A lock already held is refused at once rather than waited for, so a flood from
      // one address can't tie up the database's connections.
      for (const key of [`otp:${phone}`, deviceKey && `otp-device:${deviceKey}`, ip && `otp-ip:${ip}`]) {
        if (!key) continue;
        const { rows } = await tx.execute<{ ok: boolean }>(
          sql`select pg_try_advisory_xact_lock(hashtext(${key})) as ok`,
        );
        if (!rows[0]?.ok) {
          throw tooMany('otp_busy', 'A code is already being sent. Try again in a moment.', { retryAfterSeconds: 2 });
        }
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

      /** Codes asked for by one number, phone or address, in the last 15 minutes, hour and day. */
      const counted = async (
        column: typeof otpChallenges.phone | typeof otpChallenges.deviceKey | typeof otpChallenges.requestedIp,
        value: string,
      ) => {
        const [row] = await tx
          .select({
            quarter: sql<number>`count(*) filter (where ${otpChallenges.createdAt} > ${since(QUARTER_MS)})::int`,
            hour: sql<number>`count(*) filter (where ${otpChallenges.createdAt} > ${since(HOUR_MS)})::int`,
            day: count(),
          })
          .from(otpChallenges)
          .where(and(eq(column, value), gt(otpChallenges.createdAt, since(DAY_MS))));
        return { quarter: row?.quarter ?? 0, hour: row?.hour ?? 0, day: row?.day ?? 0 };
      };
      const over = (made: { quarter: number; day: number }) =>
        made.day >= limits.otpPerDay ? DAY_MS / 1000 : made.quarter >= limits.otpPerQuarterHour ? QUARTER_MS / 1000 : 0;

      // The number's own limits, unless this is a phone already signed in to it: someone asking for codes to
      // a stranger's number mustn't lock the owner out of their own phone (the phone's limits still hold).
      const known =
        !!deviceKey &&
        (
          await tx
            .select({ id: devices.id })
            .from(devices)
            .innerJoin(users, eq(users.id, devices.userId))
            .where(and(eq(users.phone, phone), eq(devices.deviceKey, deviceKey)))
            .limit(1)
        ).length > 0;
      const byNumber = known ? 0 : over(await counted(otpChallenges.phone, phone));
      if (byNumber) throw limited(byNumber);
      if (deviceKey) {
        const byDevice = over(await counted(otpChallenges.deviceKey, deviceKey));
        if (byDevice) throw limited(byDevice);
      }
      // A network address can be shared by many customers on a mobile network, so its limits are higher.
      if (ip) {
        const made = await counted(otpChallenges.requestedIp, ip);
        if (made.day >= this.config.OTP_PER_IP_PER_DAY) throw limited(DAY_MS / 1000);
        if (made.hour >= this.config.OTP_PER_IP_PER_HOUR) throw limited(HOUR_MS / 1000);
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
    return { expiresInSeconds: limits.otpTtlSeconds, resendInSeconds: limits.otpResendSeconds };
  }

  /**
   * Each code is a paid SMS: once the codes sent in a country in the last day pass its set level, finance
   * hears of it, once a calendar day (docs/security-plan.md, A2). A sudden rise can mean someone is sending
   * codes to numbers they found, at Jiffo's cost. Runs every few minutes, off the sign-in path.
   */
  async checkSpend() {
    const sent = await this.db
      .select({ country: otpChallenges.countryCode, n: count() })
      .from(otpChallenges)
      .where(gt(otpChallenges.createdAt, new Date(Date.now() - DAY_MS)))
      .groupBy(otpChallenges.countryCode);
    let raised = 0;
    for (const { country, n } of sent) {
      if (!country) continue;
      const level = (await this.countries.currentSettings(country)).settings.security.smsCodesDailyAlert;
      if (n < level) continue;
      await this.alerts.raiseOnce({
        countryCode: country,
        kind: 'sms_spend',
        dedupeKey: new Date().toISOString().slice(0, 10),
        message: `${n} sign-in codes were sent in the last day, above the alert level of ${level}. Each is a paid SMS.`,
        data: { sent: n, level },
      });
      raised += 1;
    }
    return { countries: sent.length, over: raised };
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
