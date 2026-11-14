import { Inject, Injectable } from '@nestjs/common';
import { and, count, eq, gt, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import { jwtVerify, SignJWT } from 'jose';
import { keyFor } from '../common/keys';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { DB, type Db, type Tx } from '../db/database.module';
import { admins, adminSessions, adminSignInAttempts, type AdminRole } from '../db/schema';
import { decrypt, encrypt, randomToken, sha256 } from '../common/crypto';
import { badRequest, conflict, notFound, tooMany, unauthorized } from '../common/errors';
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
/**
 * Sign-in pauses after too many wrong attempts. Wrong passwords count per email and network, so a stranger
 * can't lock a teammate out by guessing from somewhere else; a much higher ceiling per email stops guessing
 * spread over many networks. Wrong codes count per admin, since only someone with the password can send one.
 */
const LIMITS = {
  passwordPerEmailAndIp: { limit: 5, windowMs: 15 * MINUTE_MS },
  passwordPerEmail: { limit: 100, windowMs: HOUR_MS },
  codePerEmail: { limit: 5, windowMs: 15 * MINUTE_MS },
  perIp: { limit: 30, windowMs: HOUR_MS },
};
/** lastSeenAt is written at most this often, so every request doesn't write to the database. */
const SEEN_EVERY_MS = MINUTE_MS;

const CHALLENGE_AUDIENCE = 'jiffo-admin-challenge';
type Stage = 'code' | 'setup';

export const normaliseEmail = (email: string) => email.trim().toLowerCase();

/** Admin sign-in: invites, password, authenticator codes and sessions. */
@Injectable()
export class AdminAuthService {
  private readonly challengeKey: Uint8Array;
  /** The authenticator secrets have their own key (ADMIN_TOTP_KEY), so each key has one job. */
  private readonly totpKey: string;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {
    // Admin sign-in steps are signed apart from the app's tokens; development falls back to JWT_SECRET.
    this.challengeKey = new TextEncoder().encode(config.ADMIN_TOKEN_SECRET ?? config.JWT_SECRET);
    this.totpKey = keyFor(config, 'adminTotp').toString('hex');
  }

  /* ---------- Invites ---------- */

  /** A new invite token for an admin row. Only its hash is stored; the link is shown once. */
  async issueInvite(tx: Tx, adminId: string) {
    const token = randomToken();
    await tx
      .update(admins)
      .set({ inviteTokenHash: sha256(token), inviteExpiresAt: new Date(Date.now() + INVITE_MS), updatedAt: new Date() })
      .where(eq(admins.id, adminId));
    const base = (this.config.ADMIN_URL ?? 'http://localhost:3001').replace(/\/+$/, '');
    return { inviteUrl: `${base}/invite#${token}`, expiresInHours: INVITE_MS / HOUR_MS };
  }

  /** Adds a teammate and makes their invite link. Used by the panel and the command-line tool alike. */
  async addAdmin(tx: Tx, input: { email: string; name: string; role: AdminRole; invitedBy: string | null }) {
    const email = normaliseEmail(input.email);
    const [existing] = await tx.select({ id: admins.id }).from(admins).where(eq(admins.email, email));
    if (existing) throw conflict('admin_exists', 'Someone on the team already uses this email');
    const [admin] = await tx
      .insert(admins)
      .values({ email, name: input.name.trim(), role: input.role, invitedBy: input.invitedBy })
      .returning({ id: admins.id });
    return { id: admin!.id, email, ...(await this.issueInvite(tx, admin!.id)) };
  }

  /**
   * For a lost phone or password: clears both, ends their sessions, lifts any sign-in pause and makes a new
   * invite link. Used by the panel and the command-line tool alike, with the same rules.
   */
  async resetAccess(tx: Tx, adminId: string) {
    const [target] = await tx.select().from(admins).where(eq(admins.id, adminId)).for('update');
    if (!target) throw notFound('admin_not_found', 'Teammate not found');
    if (target.status === 'disabled') throw conflict('admin_disabled', 'Enable this teammate first');
    await tx
      .update(admins)
      .set({
        status: 'invited',
        passwordHash: null,
        totpCipher: null,
        totpEnabledAt: null,
        totpLastStep: null,
        updatedAt: new Date(),
      })
      .where(eq(admins.id, adminId));
    await this.revokeAll(tx, adminId, 'reset');
    await tx
      .delete(adminSignInAttempts)
      .where(and(eq(adminSignInAttempts.email, target.email), eq(adminSignInAttempts.succeeded, false)));
    return this.issueInvite(tx, adminId);
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
    const admin = await this.limited(email, client.ip, 'password', async (tx) => {
      const [row] = await tx.select().from(admins).where(eq(admins.email, email));
      // Unknown, invited and disabled admins get the same answer, after the same amount of work.
      const ok =
        row?.status === 'active' && row.passwordHash
          ? await verifyPassword(password, row.passwordHash)
          : await verifyPassword(password, await decoyHash()).then(() => false);
      return ok ? row! : null;
    });
    if (!admin) throw unauthorized('invalid_credentials', 'That email and password do not match');

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
    if (!admin.totpCipher) throw badRequest('setup_not_started', 'Set up your authenticator app first');
    const secret = decrypt(this.totpKey, admin.totpCipher);

    const session = await this.limited(admin.email, client.ip, 'code', async (tx) => {
      const step = matchTotp(secret, code.trim(), admin.totpLastStep);
      if (step === null) return null;
      // Marked as used in the same statement that checks it, so the same code can't sign in twice at once.
      const [accepted] = await tx
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
      if (!accepted) return null;
      const token = randomToken();
      const expiresAt = new Date(Date.now() + ADMIN_SESSION_MS);
      await tx.insert(adminSessions).values({
        adminId: admin.id,
        tokenHash: sha256(token),
        ip: client.ip,
        userAgent: client.userAgent?.slice(0, 300) ?? null,
        expiresAt,
      });
      return { token, expiresAt: expiresAt.toISOString(), idleMinutes: ADMIN_IDLE_MS / MINUTE_MS };
    });
    if (!session) {
      throw unauthorized('wrong_code', 'That code is not right. Check the time on your phone and try the newest code.');
    }
    return session;
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

  /**
   * Runs one sign-in check under the limits. Attempts for the same email, and from the same network, wait
   * their turn on a lock, so a burst of requests can't all pass the limit before any failure is written.
   * The attempt is recorded in the same transaction; a wrong answer is returned as null rather than thrown,
   * so that record is kept.
   */
  private async limited<T>(
    email: string,
    ip: string | null,
    stage: 'password' | 'code',
    check: (tx: Tx) => Promise<T | null>,
  ): Promise<T | null> {
    return this.db
      .transaction(async (tx) => {
        // Always the email first, then the network, so two attempts can never wait on each other.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'admin-email:' + email}))`);
        if (ip) await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'admin-ip:' + ip}))`);

        const failures = async (where: SQL | undefined, windowMs: number) => {
          const [row] = await tx
            .select({ n: count() })
            .from(adminSignInAttempts)
            .where(
              and(
                where,
                eq(adminSignInAttempts.succeeded, false),
                gt(adminSignInAttempts.createdAt, new Date(Date.now() - windowMs)),
              ),
            );
          return row?.n ?? 0;
        };
        const byEmail = (s: 'password' | 'code') =>
          and(eq(adminSignInAttempts.email, email), eq(adminSignInAttempts.stage, s));
        const sameIp = ip ? eq(adminSignInAttempts.ip, ip) : isNull(adminSignInAttempts.ip);
        const over = (n: number, rule: { limit: number }) => n >= rule.limit;

        const paused =
          stage === 'password'
            ? over(
                await failures(and(byEmail('password'), sameIp), LIMITS.passwordPerEmailAndIp.windowMs),
                LIMITS.passwordPerEmailAndIp,
              ) || over(await failures(byEmail('password'), LIMITS.passwordPerEmail.windowMs), LIMITS.passwordPerEmail)
            : over(await failures(byEmail('code'), LIMITS.codePerEmail.windowMs), LIMITS.codePerEmail);
        if (paused) return { paused: 'email' as const };
        if (ip && over(await failures(sameIp, LIMITS.perIp.windowMs), LIMITS.perIp)) return { paused: 'ip' as const };

        const result = await check(tx);
        await tx.insert(adminSignInAttempts).values({ email, ip, stage, succeeded: result !== null });
        return { result };
      })
      .then((outcome) => {
        if ('paused' in outcome) {
          throw tooMany(
            'too_many_attempts',
            outcome.paused === 'ip'
              ? 'Too many wrong attempts from this network. Try again later.'
              : 'Too many wrong attempts. Wait 15 minutes and try again.',
          );
        }
        return outcome.result;
      });
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
