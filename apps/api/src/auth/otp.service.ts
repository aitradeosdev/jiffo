import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, gt, sql } from 'drizzle-orm';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { DB, type Db } from '../db/database.module';
import { otpChallenges } from '../db/schema';
import { CountriesService } from '../countries/countries.service';
import { MESSAGING, type MessagingAdapter } from '../adapters/messaging';
import { hmacSha256, numericCode, safeEqual } from '../common/crypto';
import { badRequest, tooMany } from '../common/errors';

const HOUR_MS = 3_600_000;

/** One-time sign-in codes: 6 digits, stored only as an HMAC, short-lived, limited per number and per IP. */
@Injectable()
export class OtpService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(MESSAGING) private readonly messaging: MessagingAdapter,
    private readonly countries: CountriesService,
  ) {}

  private hash(phone: string, code: string) {
    return hmacSha256(this.config.OTP_SECRET, `${phone}:${code}`);
  }

  async request(phone: string, country: string, ip: string | null) {
    const { limits } = (await this.countries.currentSettings(country)).settings;
    const code = numericCode(6);
    const now = Date.now();

    const challengeId = await this.db.transaction(async (tx) => {
      // One request at a time per number, so two quick taps cannot both pass the limits.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'otp:' + phone}))`);
      const hourAgo = new Date(now - HOUR_MS);

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

      const [perPhone] = await tx
        .select({ n: count() })
        .from(otpChallenges)
        .where(and(eq(otpChallenges.phone, phone), gt(otpChallenges.createdAt, hourAgo)));
      if ((perPhone?.n ?? 0) >= limits.otpPerHour) {
        throw tooMany('otp_rate_limited', 'Too many codes for this number. Try again in an hour.');
      }

      if (ip) {
        const [perIp] = await tx
          .select({ n: count() })
          .from(otpChallenges)
          .where(and(eq(otpChallenges.requestedIp, ip), gt(otpChallenges.createdAt, hourAgo)));
        if ((perIp?.n ?? 0) >= this.config.OTP_PER_IP_PER_HOUR) {
          throw tooMany('otp_rate_limited', 'Too many codes requested. Try again later.');
        }
      }

      const [row] = await tx
        .insert(otpChallenges)
        .values({
          phone,
          codeHash: this.hash(phone, code),
          requestedIp: ip,
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
