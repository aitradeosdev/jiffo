import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, ne } from 'drizzle-orm';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { DB, type Db, type Tx } from '../db/database.module';
import { devices, refreshTokens, sessions, users, type AppName } from '../db/schema';
import { CountriesService } from '../countries/countries.service';
import { sha256 } from '../common/crypto';
import { forbidden, unauthorized } from '../common/errors';
import { PushService } from '../push/push.service';
import { normalisePhone } from './phone';
import { OtpService } from './otp.service';
import { TokensService } from './tokens.service';
import type { AuthContext, TokenClaims } from './auth.types';

const DAY_MS = 86_400_000;

/** A refresh token used twice: every session it ended, for their sockets to be dropped too. */
export class RefreshReused extends Error {
  constructor(readonly ended: string[]) {
    super('refresh_token_reused');
  }
}

export interface DeviceInfo {
  key: string;
  platform: 'ios' | 'android' | 'web';
  name?: string | undefined;
}

export const publicUser = (u: typeof users.$inferSelect) => ({
  id: u.id,
  phone: u.phone,
  countryCode: u.countryCode,
  firstName: u.firstName,
  lastName: u.lastName,
  email: u.email,
  createdAt: u.createdAt,
});

@Injectable()
export class AuthService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly countries: CountriesService,
    private readonly otp: OtpService,
    private readonly tokens: TokensService,
    private readonly push: PushService,
  ) {}

  /** How long a session lasts from now, never past its absolute end (SESSION_MAX_DAYS after sign-in). */
  private sessionUntil(absolute: Date) {
    return new Date(Math.min(Date.now() + this.config.REFRESH_TOKEN_TTL_DAYS * DAY_MS, absolute.getTime()));
  }

  private async resolvePhone(input: string) {
    const { e164, country } = normalisePhone(input, this.config.DEFAULT_COUNTRY);
    await this.countries.enabledCountry(country);
    return { phone: e164, country };
  }

  async requestCode(phoneInput: string, ip: string | null, deviceKey: string | null = null) {
    const { phone, country } = await this.resolvePhone(phoneInput);
    return { phone, ...(await this.otp.request(phone, country, ip, deviceKey)) };
  }

  /** Signs in with a code. The same phone number is one account across both apps. */
  async verifyCode(phoneInput: string, code: string, app: AppName, device: DeviceInfo) {
    const { phone, country } = await this.resolvePhone(phoneInput);
    await this.otp.verify(phone, country, code);

    return this.db.transaction(async (tx) => {
      const inserted = await tx
        .insert(users)
        .values({ phone, countryCode: country })
        .onConflictDoNothing({ target: users.phone })
        .returning();
      const user = inserted[0] ?? (await tx.select().from(users).where(eq(users.phone, phone)))[0]!;
      if (user.status !== 'active') throw forbidden('account_suspended', 'This account is suspended. Contact support.');

      const [deviceRow] = await tx
        .insert(devices)
        .values({ userId: user.id, deviceKey: device.key, app, platform: device.platform, name: device.name ?? null })
        .onConflictDoUpdate({
          target: [devices.userId, devices.deviceKey, devices.app],
          set: { platform: device.platform, name: device.name ?? null, lastSeenAt: new Date() },
        })
        .returning();

      // Signing in again on the same phone replaces the old session there.
      const replaced = await tx
        .update(sessions)
        .set({ revokedAt: new Date(), revokedReason: 'replaced' })
        .where(and(eq(sessions.deviceId, deviceRow!.id), isNull(sessions.revokedAt)))
        .returning({ id: sessions.id });
      // Signing in on a new phone signs the others out of this app (docs/security-plan.md, A8): whoever took
      // over the number shows up as the owner being signed out, and the owner signing back in ends theirs.
      const elsewhere = await tx
        .update(sessions)
        .set({ revokedAt: new Date(), revokedReason: 'new_device' })
        .where(
          and(
            eq(sessions.userId, user.id),
            eq(sessions.app, app),
            ne(sessions.deviceId, deviceRow!.id),
            isNull(sessions.revokedAt),
          ),
        )
        .returning({ id: sessions.id, deviceId: sessions.deviceId });

      const absolute = new Date(Date.now() + this.config.SESSION_MAX_DAYS * DAY_MS);
      const [session] = await tx
        .insert(sessions)
        .values({
          userId: user.id,
          deviceId: deviceRow!.id,
          app,
          expiresAt: this.sessionUntil(absolute),
          absoluteExpiresAt: absolute,
        })
        .returning();

      const auth: TokenClaims = { userId: user.id, sessionId: session!.id, deviceId: deviceRow!.id, app };
      return {
        response: { ...(await this.issue(tx, auth)), user: publicUser(user), isNewUser: inserted.length > 0 },
        /** Sessions this sign-in ended; their open sockets must be dropped too. */
        replacedSessionIds: [...replaced, ...elsewhere].map((r) => r.id),
        signedOutDevices: [...new Set(elsewhere.map((r) => r.deviceId))],
      };
    });
  }

  /** Tells the phones a new sign-in signed out, so a sign-in the owner didn't make doesn't go unnoticed. */
  async tellSignedOut(deviceIds: string[]) {
    await this.push.notifyDevices(deviceIds, {
      title: 'Signed in on another phone',
      body: "Your Jiffo account was just signed in on another phone, so this one was signed out. If that wasn't you, sign in again and contact support.",
      data: { type: 'auth.signed_out' },
    });
  }

  /** Swaps a refresh token for a new pair. A token that was already used revokes the whole session. */
  async refresh(refreshToken: string) {
    const hash = sha256(refreshToken);
    const result = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .select({ token: refreshTokens, session: sessions })
        .from(refreshTokens)
        .innerJoin(sessions, eq(sessions.id, refreshTokens.sessionId))
        .where(eq(refreshTokens.tokenHash, hash))
        .for('update');
      if (!row) return { error: 'invalid' as const };
      const { token, session } = row;
      if (session.revokedAt || session.expiresAt.getTime() <= Date.now()) return { error: 'invalid' as const };
      if (token.usedAt) {
        // A used token again means it was copied: every session of the account ends, in both apps, since
        // whoever copied it may hold others too (docs/security-plan.md, A8).
        const ended = await tx
          .update(sessions)
          .set({ revokedAt: new Date(), revokedReason: 'refresh_reuse' })
          .where(and(eq(sessions.userId, session.userId), isNull(sessions.revokedAt)))
          .returning({ id: sessions.id });
        return { error: 'reused' as const, ended: ended.map((e) => e.id) };
      }
      if (token.expiresAt.getTime() <= Date.now()) return { error: 'invalid' as const };

      await tx.update(refreshTokens).set({ usedAt: new Date() }).where(eq(refreshTokens.id, token.id));
      // Moves forward, but never past the session's absolute end: then the person signs in again.
      const absolute =
        session.absoluteExpiresAt ?? new Date(session.createdAt.getTime() + this.config.SESSION_MAX_DAYS * DAY_MS);
      if (absolute.getTime() <= Date.now()) return { error: 'invalid' as const };
      await tx
        .update(sessions)
        .set({ expiresAt: this.sessionUntil(absolute), absoluteExpiresAt: absolute })
        .where(eq(sessions.id, session.id));
      await tx.update(devices).set({ lastSeenAt: new Date() }).where(eq(devices.id, session.deviceId));
      const auth: TokenClaims = {
        userId: session.userId,
        sessionId: session.id,
        deviceId: session.deviceId,
        app: session.app,
      };
      return { tokens: await this.issue(tx, auth) };
    });

    if ('tokens' in result) return { tokens: result.tokens, ended: [] as string[] };
    if (result.error === 'reused') {
      throw new RefreshReused(result.ended ?? []);
    }
    throw unauthorized('invalid_refresh_token', 'Sign in again');
  }

  /** Ends this session and stops push notifications to this phone. */
  async logout(auth: AuthContext) {
    await this.db.transaction(async (tx) => {
      await tx
        .update(sessions)
        .set({ revokedAt: new Date(), revokedReason: 'logout' })
        .where(and(eq(sessions.id, auth.sessionId), isNull(sessions.revokedAt)));
      await tx.update(devices).set({ pushToken: null, pushUpdatedAt: new Date() }).where(eq(devices.id, auth.deviceId));
    });
  }

  /** Signs out every other phone, e.g. after the account owner reports a lost phone. */
  async logoutOthers(auth: AuthContext) {
    const ended = await this.db
      .update(sessions)
      .set({ revokedAt: new Date(), revokedReason: 'logout_others' })
      .where(and(eq(sessions.userId, auth.userId), ne(sessions.id, auth.sessionId), isNull(sessions.revokedAt)))
      .returning({ id: sessions.id });
    return ended.map((s) => s.id);
  }

  private async issue(tx: Tx, auth: TokenClaims) {
    const refresh = this.tokens.newRefreshToken();
    await tx.insert(refreshTokens).values({
      sessionId: auth.sessionId,
      tokenHash: refresh.hash,
      expiresAt: new Date(Date.now() + this.config.REFRESH_TOKEN_TTL_DAYS * DAY_MS),
    });
    return {
      accessToken: await this.tokens.signAccess(auth),
      accessTokenExpiresIn: this.tokens.accessTtlSeconds,
      refreshToken: refresh.token,
    };
  }
}
