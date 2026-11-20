import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gte, isNull, ne } from 'drizzle-orm';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { AttestationService, type AttestContext } from '../attestation/attestation.service';
import { DB, type Db, type Tx } from '../db/database.module';
import { devices, refreshTokens, sessions, users, type AppName } from '../db/schema';
import { CountriesService } from '../countries/countries.service';
import { sha256 } from '../common/crypto';
import { forbidden, unauthorized } from '../common/errors';
import { PushService } from '../push/push.service';
import { RiskFlagsService } from '../risk/risk-flags.service';
import { SignInRiskService } from '../risk/sign-in-risk.service';
import { WithdrawalHoldsService } from '../money/withdrawal-holds.service';
import { normalisePhone } from './phone';
import { OtpService } from './otp.service';
import { TokensService } from './tokens.service';
import type { AuthContext, TokenClaims } from './auth.types';

const DAY_MS = 86_400_000;
/** A refresh sent again this soon after, with the token it was swapped for unused, is the app retrying. */
const RETRY_GRACE_MS = 60_000;

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
  /** The phone's own id, kept only as a keyed hash, to flag accounts sharing a phone (I3, E6). */
  phoneId?: string | undefined;
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
    private readonly holds: WithdrawalHoldsService,
    private readonly attestation: AttestationService,
    private readonly risk: RiskFlagsService,
    private readonly signInRisk: SignInRiskService,
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
  async verifyCode(
    phoneInput: string,
    code: string,
    app: AppName,
    device: DeviceInfo,
    attest: Pick<AttestContext, 'evidence' | 'request'> = {
      evidence: {},
      request: { method: 'POST', path: '/v1/auth/otp/verify', body: undefined },
    },
    client: { ip: string | null; network?: string } = { ip: null },
  ) {
    // The apps' web builds keep tokens in the browser's storage, not the phone's keychain (docs/security-plan.md,
    // MB2): they are for development only. Refused before the code is checked, so it still works in the app.
    // The platform is the app's own word, so this stops Jiffo's web builds, not a script that says it is a
    // phone: app attestation (MB3) is what proves a sign-in comes from the store app.
    if (device.platform === 'web' && this.config.NODE_ENV === 'production') {
      throw forbidden('web_sign_in_off', 'Sign in with the Jiffo app from the App Store or Google Play');
    }
    const { phone, country } = await this.resolvePhone(phoneInput);
    await this.otp.verify(phone, country, code);
    // Our store app on a real phone (MB3), checked once the code is right, so nobody can make Jiffo ask Google
    // or Apple without one. A doubtful phone in the agent app needs a selfie before money moves on it.
    const [known] = await this.db.select({ id: users.id }).from(users).where(eq(users.phone, phone));
    const attested = await this.attestation.enforce({
      purpose: 'sign_in',
      deviceKey: device.key,
      platform: device.platform,
      app,
      userId: known?.id ?? null,
      countryCode: country,
      ...attest,
    });

    const phoneFingerprint = this.risk.phoneFingerprint(device.platform, device.phoneId);
    // How risky this sign-up or sign-in looks (A10). A high score asks for more, never refuses: a selfie before
    // an agent's money moves, and a person to look in the Risk queue.
    const risk = await this.signInRisk.assess({
      countryCode: country,
      app,
      userId: known?.id ?? null,
      deviceKey: device.key,
      phoneFingerprint,
      signals: attest.evidence.signals ?? [],
      network: client.network,
      ip: client.ip,
    });
    const signedIn = await this.db.transaction(async (tx) => {
      const inserted = await tx
        .insert(users)
        .values({ phone, countryCode: country })
        .onConflictDoNothing({ target: users.phone })
        .returning();
      const user = inserted[0] ?? (await tx.select().from(users).where(eq(users.phone, phone)))[0]!;
      if (user.status !== 'active') throw forbidden('account_suspended', 'This account is suspended. Contact support.');

      // A phone the agent app has never seen on this account, when it has seen others: whoever has the number
      // now may not be the agent, so their withdrawals wait (docs/security-plan.md, A6, X4). An agent's first
      // phone, and the customer app, don't count.
      // A phone its owner asked to forget counts as new, and a forgotten one still counts as having had a phone:
      // whoever kept it can't skip the hold, even on the agent's only phone.
      const known =
        app === 'agent'
          ? await tx
              .select({ key: devices.deviceKey, forgottenAt: devices.forgottenAt })
              .from(devices)
              .where(and(eq(devices.userId, user.id), eq(devices.app, 'agent')))
          : [];
      const newPhone = known.length > 0 && !known.some((d) => d.key === device.key && !d.forgottenAt);
      const doubtful = (attested === 'doubtful' || risk.stepUp) && app === 'agent';
      const heldUntil = newPhone ? await this.holds.start(tx, user.id, 'new_device') : null;

      const [deviceRow] = await tx
        .insert(devices)
        .values({
          userId: user.id,
          deviceKey: device.key,
          app,
          platform: device.platform,
          name: device.name ?? null,
          // A new phone, or one the app check doubts, needs a selfie before money actions (A4, X4, MB3).
          selfieNeeded: newPhone || doubtful,
          // What the app found on the phone (MB4), as it said at this sign-in.
          riskSignals: attest.evidence.signals ?? [],
          riskSignalsAt: new Date(),
          signInRiskScore: risk.score,
          signInRiskReasons: risk.reasons,
          phoneFingerprint,
        })
        .onConflictDoUpdate({
          target: [devices.userId, devices.deviceKey, devices.app],
          set: {
            platform: device.platform,
            name: device.name ?? null,
            lastSeenAt: new Date(),
            forgottenAt: null,
            ...(newPhone || doubtful ? { selfieNeeded: true } : {}),
            riskSignals: attest.evidence.signals ?? [],
            riskSignalsAt: new Date(),
            signInRiskScore: risk.score,
            signInRiskReasons: risk.reasons,
            // An app that sends none (an older version) keeps the one it sent before.
            ...(phoneFingerprint ? { phoneFingerprint } : {}),
          },
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
        /** Set when this sign-in started a hold on withdrawals, to tell the agent once it is saved. */
        heldUntil: heldUntil ? { userId: user.id, until: heldUntil } : null,
        device: { userId: user.id, id: deviceRow!.id },
      };
    });
    // Another account on this phone is flagged for verification, beside the sign-in (I3).
    this.risk.phoneUsed(signedIn.device.userId, signedIn.device.id);
    if (risk.stepUp) {
      this.risk.riskySignIn({ countryCode: country, userId: signedIn.device.userId, app, ...risk });
    }
    const { device: _signedInOn, ...out } = signedIn;
    return out;
  }

  /**
   * Tells the agent a new phone's sign-in paused their withdrawals, by SMS and email; the push goes to their
   * other phones with the signed-out notice. Not waited for, and it never throws.
   */
  tellHeld(held: { userId: string; until: Date } | null) {
    if (held) void this.holds.tell(held.userId, 'new_device', held.until, { push: false });
  }

  /** Tells the phones a new sign-in signed out, so a sign-in the owner didn't make doesn't go unnoticed. */
  tellSignedOut(deviceIds: string[], held: { userId: string; until: Date } | null = null) {
    // Not waited for: the new phone's sign-in shouldn't wait on the push provider.
    void (async () => {
      // A hold it started is said here too: these are the phones the owner had, where the number someone
      // may have taken over doesn't reach (docs/security-plan.md, A6).
      const hold = held ? ` ${await this.holds.sentence(held.userId, held.until)}` : '';
      await this.push.notifyDevices(deviceIds, {
        title: 'Signed in on another phone',
        body: `Your Jiffo account was just signed in on another phone, so this one was signed out.${hold} If that wasn't you, sign in again and contact support.`,
        data: { type: 'auth.signed_out' },
      });
    })().catch(() => undefined);
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
        // The app sending it again just after, because the answer was lost on the way: the token it was
        // swapped for (the next one issued in the session) was never used, so this is the same app asking
        // again. It gets a new pair, and the unused one is let go.
        const [child] = await tx
          .select()
          .from(refreshTokens)
          .where(
            and(
              eq(refreshTokens.sessionId, session.id),
              ne(refreshTokens.id, token.id),
              gte(refreshTokens.createdAt, token.createdAt),
            ),
          )
          .orderBy(asc(refreshTokens.createdAt))
          .limit(1)
          .for('update');
        const retry = Date.now() - token.usedAt.getTime() <= RETRY_GRACE_MS && !!child && !child.usedAt;
        if (retry) {
          await tx.update(refreshTokens).set({ usedAt: new Date() }).where(eq(refreshTokens.id, child.id));
          const auth: TokenClaims = {
            userId: session.userId,
            sessionId: session.id,
            deviceId: session.deviceId,
            app: session.app,
          };
          return { tokens: await this.issue(tx, auth) };
        }
        // Otherwise it was copied: every session of the account ends, in both apps, since whoever copied it
        // may hold others too (docs/security-plan.md, A8).
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
      // A session from before there was a limit gets its full length from now, rather than ending at once.
      const absolute = session.absoluteExpiresAt ?? new Date(Date.now() + this.config.SESSION_MAX_DAYS * DAY_MS);
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

  /**
   * Signs this phone out. Forgetting it too, for a phone being handed on, drops its key from the account and
   * makes the next sign-in on it count as a new phone, with the withdrawal hold (docs/security-plan.md, A6).
   */
  async logout(auth: AuthContext, options: { forgetPhone?: boolean } = {}) {
    await this.db.transaction(async (tx) => {
      await tx
        .update(sessions)
        .set({ revokedAt: new Date(), revokedReason: options.forgetPhone ? 'logout_forget_phone' : 'logout' })
        .where(and(eq(sessions.id, auth.sessionId), isNull(sessions.revokedAt)));
      await tx
        .update(devices)
        .set({
          pushToken: null,
          pushUpdatedAt: new Date(),
          ...(options.forgetPhone ? { publicKey: null, keyAddedAt: null, forgottenAt: new Date() } : {}),
        })
        .where(eq(devices.id, auth.deviceId));
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
