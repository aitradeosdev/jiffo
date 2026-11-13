import { Inject, Injectable } from '@nestjs/common';
import { and, count, eq, gt, isNull, lt, or } from 'drizzle-orm';
import { jwtVerify, SignJWT } from 'jose';
import { hkdfSync } from 'node:crypto';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { DB, type Db, type Tx } from '../db/database.module';
import { admins, adminSessions, adminSignInAttempts, type AdminRole } from '../db/schema';
import { decrypt, encrypt, randomToken, sha256 } from '../common/crypto';
import { badRequest, notFound, tooMany, unauthorized } from '../common/errors';
import { decoyHash, hashPassword, PASSWORD_MIN_LENGTH, verifyPassword } from './passwords';
import { matchTotp, newTotpSecret, otpauthUrl } from './totp';
import { permissionsFor } from './permissions';
import type { AdminContext, ClientInfo } from './admin.types';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/** A session ends after this long without a request, and in any case this long after sign-in. */
export const ADMIN_IDLE_MS = 30 * MINUTE_MS;
export const ADMIN_SESSION_MS = 12 * HOUR_MS;
/** How long an invite link works. */
export const INVITE_MS = 72 * HOUR_MS;
/** Between the password and the code. */
const CHALLENGE_SECONDS = 10 * 60;
/** Wrong passwords or codes for one email, and failures from one IP address, before sign-in pauses. */
const EMAIL_FAILURES = { limit: 5, windowMs: 15 * MINUTE_MS };
const IP_FAILURES = { limit: 30, windowMs: HOUR_MS };
/** lastSeenAt is written at most this often, so every request doesn't write to the database. */
const SEEN_EVERY_MS = MINUTE_MS;

const CHALLENGE_AUDIENCE = 'jiffo-admin-challenge';
type Stage = 'code' | 'setup';

export const normaliseEmail = (email: string) => email.trim().toLowerCase();

/** Admin sign-in: invites, password, authenticator codes and sessions. */
@Injectable()
export class AdminAuthService {
  private readonly challengeKey: Uint8Array;
  /** The authenticator secrets have their own key, derived from PIN_KEY, so each key has one job. */
  private readonly totpKey: string;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {
    this.challengeKey = new TextEncoder().encode(config.JWT_SECRET);
    this.totpKey = Buffer.from(
      hkdfSync('sha256', Buffer.from(config.PIN_KEY, 'hex'), Buffer.alloc(0), 'jiffo admin totp', 32),
    ).toString('hex');
  }

  /* ---------- Invites ---------- */

  /** A new invite token for an admin row. Only its hash is stored; the link is shown once. */
  async issueInvite(tx: Tx, adminId: string) {
    const token = randomToken();
    await tx
      .update(admins)
      .set({ inviteTokenHash: sha256(token), inviteExpiresAt: new Date(Date.now() + INVITE_MS), updatedAt: new Date() })
      .where(eq(admins.id, adminId));
    return { inviteUrl: `${this.config.ADMIN_URL}/invite#${token}`, expiresInHours: INVITE_MS / HOUR_MS };
  }

  private async invited(token: string) {
    const [admin] = await this.db
      .select()
      .from(admins)
      .where(and(eq(admins.inviteTokenHash, sha256(token)), eq(admins.status, 'invited')));
    if (!admin || !admin.inviteExpiresAt || admin.inviteExpiresAt.getTime() <= Date.now()) {
      throw notFound('invite_invalid', 'This invite link has expired or was already used. Ask for a new one.');
    }
    return admin;
  }

  async inviteInfo(token: string) {
    const admin = await this.invited(token);
    return { email: admin.email, name: admin.name, role: admin.role };
  }

  /** Sets the password. The authenticator app is set up at the first sign-in. */
  async acceptInvite(token: string, password: string) {
    if (password.length < PASSWORD_MIN_LENGTH) {
      throw badRequest('password_too_short', `Use at least ${PASSWORD_MIN_LENGTH} characters`);
    }
    const admin = await this.invited(token);
    const [done] = await this.db
      .update(admins)
      .set({
        passwordHash: await hashPassword(password),
        status: 'active',
        inviteTokenHash: null,
        inviteExpiresAt: null,
        updatedAt: new Date(),
      })
      // The same link used twice at once: only the first one wins.
      .where(and(eq(admins.id, admin.id), eq(admins.inviteTokenHash, sha256(token))))
      .returning({ email: admins.email });
    if (!done) throw notFound('invite_invalid', 'This invite link has expired or was already used. Ask for a new one.');
    return { email: done.email };
  }

  /* ---------- Sign-in ---------- */

  /** Step one: email and password. Answers with what comes next: a code, or setting up the authenticator app. */
  async signIn(emailInput: string, password: string, client: ClientInfo) {
    const email = normaliseEmail(emailInput);
    await this.assertNotLimited(email, client.ip);
    const [admin] = await this.db.select().from(admins).where(eq(admins.email, email));
    // Unknown, invited and disabled admins get the same answer, after the same amount of work.
    const ok =
      admin?.status === 'active' && admin.passwordHash
        ? await verifyPassword(password, admin.passwordHash)
        : await verifyPassword(password, await decoyHash()).then(() => false);
    await this.recordAttempt(email, client.ip, 'password', ok);
    if (!ok || !admin) throw unauthorized('invalid_credentials', 'That email and password do not match');

    const stage: Stage = admin.totpEnabledAt ? 'code' : 'setup';
    return { next: stage, challenge: await this.signChallenge(admin.id, stage) };
  }

  /**
   * Step two for a first sign-in: the authenticator secret to scan. Asking again gives the same secret until
   * the app is switched on, so reloading the page doesn't undo a scan already made.
   */
  async startSetup(challenge: string) {
    const { admin } = await this.readChallenge(challenge, 'setup');
    let secret = admin.totpCipher ? decrypt(this.totpKey, admin.totpCipher) : null;
    if (!secret) {
      secret = newTotpSecret();
      await this.db
        .update(admins)
        .set({ totpCipher: encrypt(this.totpKey, secret), updatedAt: new Date() })
        .where(eq(admins.id, admin.id));
    }
    return { secret, otpauthUrl: otpauthUrl(secret, admin.email) };
  }

  /** Step two: the code from the authenticator app. A first sign-in also switches the app on here. */
  async verifyCode(challenge: string, code: string, client: ClientInfo) {
    const { admin, stage } = await this.readChallenge(challenge);
    await this.assertNotLimited(admin.email, client.ip);
    if (!admin.totpCipher) throw badRequest('setup_not_started', 'Set up your authenticator app first');
    const secret = decrypt(this.totpKey, admin.totpCipher);
    const step = matchTotp(secret, code.trim(), admin.totpLastStep);

    // Recorded as used in the same statement that checks it, so the same code can't sign in twice at once.
    const accepted =
      step === null
        ? []
        : await this.db
            .update(admins)
            .set({
              totpLastStep: step,
              lastSignInAt: new Date(),
              updatedAt: new Date(),
              ...(stage === 'setup' ? { totpEnabledAt: new Date() } : {}),
            })
            .where(
              and(
                eq(admins.id, admin.id),
                or(isNull(admins.totpLastStep), lt(admins.totpLastStep, step)),
                eq(admins.status, 'active'),
              ),
            )
            .returning({ id: admins.id });
    const ok = accepted.length > 0;
    await this.recordAttempt(admin.email, client.ip, 'code', ok);
    if (!ok)
      throw unauthorized('wrong_code', 'That code is not right. Check the time on your phone and try the newest code.');

    const token = randomToken();
    const now = Date.now();
    const expiresAt = new Date(now + ADMIN_SESSION_MS);
    await this.db.insert(adminSessions).values({
      adminId: admin.id,
      tokenHash: sha256(token),
      ip: client.ip,
      userAgent: client.userAgent?.slice(0, 300) ?? null,
      expiresAt,
    });
    return { token, expiresAt: expiresAt.toISOString(), idleMinutes: ADMIN_IDLE_MS / MINUTE_MS };
  }

  /* ---------- Sessions ---------- */

  /** The admin behind a session token, if the session is live; it ends here if it has been idle too long. */
  async authenticate(token: string, client: ClientInfo): Promise<AdminContext> {
    const [row] = await this.db
      .select({ session: adminSessions, admin: admins })
      .from(adminSessions)
      .innerJoin(admins, eq(admins.id, adminSessions.adminId))
      .where(eq(adminSessions.tokenHash, sha256(token)));
    const now = Date.now();
    if (!row || row.session.revokedAt || row.session.expiresAt.getTime() <= now) {
      throw unauthorized('session_ended', 'Sign in again');
    }
    if (row.admin.status !== 'active') {
      await this.revoke(row.session.id, 'admin_disabled');
      throw unauthorized('session_ended', 'Sign in again');
    }
    if (now - row.session.lastSeenAt.getTime() > ADMIN_IDLE_MS) {
      await this.revoke(row.session.id, 'idle');
      throw unauthorized('session_idle', 'You were signed out after 30 minutes without activity');
    }
    if (now - row.session.lastSeenAt.getTime() > SEEN_EVERY_MS) {
      await this.db
        .update(adminSessions)
        .set({ lastSeenAt: new Date(now) })
        .where(eq(adminSessions.id, row.session.id));
    }
    return {
      adminId: row.admin.id,
      sessionId: row.session.id,
      email: row.admin.email,
      name: row.admin.name,
      role: row.admin.role,
      ip: client.ip,
    };
  }

  async signOut(sessionId: string) {
    await this.revoke(sessionId, 'signed_out');
  }

  /** Ends every live session of an admin, for example when they are disabled or their access is reset. */
  async revokeAll(tx: Tx, adminId: string, reason: string) {
    await tx
      .update(adminSessions)
      .set({ revokedAt: new Date(), revokedReason: reason })
      .where(and(eq(adminSessions.adminId, adminId), isNull(adminSessions.revokedAt)));
  }

  me(auth: AdminContext) {
    return {
      id: auth.adminId,
      email: auth.email,
      name: auth.name,
      role: auth.role,
      permissions: permissionsFor(auth.role as AdminRole),
    };
  }

  private revoke(sessionId: string, reason: string) {
    return this.db
      .update(adminSessions)
      .set({ revokedAt: new Date(), revokedReason: reason })
      .where(and(eq(adminSessions.id, sessionId), isNull(adminSessions.revokedAt)));
  }

  /* ---------- Limits and challenges ---------- */

  private async assertNotLimited(email: string, ip: string | null) {
    const failures = async (
      column: typeof adminSignInAttempts.email | typeof adminSignInAttempts.ip,
      value: string,
      windowMs: number,
    ) => {
      const [row] = await this.db
        .select({ n: count() })
        .from(adminSignInAttempts)
        .where(
          and(
            eq(column, value),
            eq(adminSignInAttempts.succeeded, false),
            gt(adminSignInAttempts.createdAt, new Date(Date.now() - windowMs)),
          ),
        );
      return row?.n ?? 0;
    };
    if ((await failures(adminSignInAttempts.email, email, EMAIL_FAILURES.windowMs)) >= EMAIL_FAILURES.limit) {
      throw tooMany('too_many_attempts', 'Too many wrong attempts. Wait 15 minutes and try again.');
    }
    if (ip && (await failures(adminSignInAttempts.ip, ip, IP_FAILURES.windowMs)) >= IP_FAILURES.limit) {
      throw tooMany('too_many_attempts', 'Too many wrong attempts from this network. Try again later.');
    }
  }

  private recordAttempt(email: string, ip: string | null, stage: 'password' | 'code', succeeded: boolean) {
    return this.db.insert(adminSignInAttempts).values({ email, ip, stage, succeeded });
  }

  private signChallenge(adminId: string, stage: Stage) {
    return new SignJWT({ stage })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(adminId)
      .setAudience(CHALLENGE_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${CHALLENGE_SECONDS}s`)
      .sign(this.challengeKey);
  }

  private async readChallenge(challenge: string, want?: Stage) {
    let adminId: string | undefined;
    let stage: unknown;
    try {
      const { payload } = await jwtVerify(challenge, this.challengeKey, {
        audience: CHALLENGE_AUDIENCE,
        algorithms: ['HS256'],
      });
      adminId = payload.sub;
      stage = payload.stage;
    } catch {
      // Falls through to the error below.
    }
    if (!adminId || (stage !== 'code' && stage !== 'setup') || (want && stage !== want)) {
      throw unauthorized('challenge_expired', 'Sign in again');
    }
    const [admin] = await this.db.select().from(admins).where(eq(admins.id, adminId));
    // The setup step only works until the app is switched on, so a stolen password can't replace it.
    if (!admin || admin.status !== 'active' || (stage === 'setup' && admin.totpEnabledAt)) {
      throw unauthorized('challenge_expired', 'Sign in again');
    }
    return { admin, stage: stage as Stage };
  }
}
