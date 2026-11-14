import { Inject, Injectable } from '@nestjs/common';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { and, asc, count, eq, gt, isNull } from 'drizzle-orm';
import { needsPasskey } from '@jiffo/shared';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { badRequest, conflict, notFound, unauthorized } from '../common/errors';
import { DB, type Db, type Tx } from '../db/database.module';
import { adminPasskeyChallenges, adminPasskeys, admins } from '../db/schema';

type Purpose = 'register' | 'sign_in' | 'confirm';
/** How long the browser has to answer a passkey request. */
const CHALLENGE_MS = 5 * 60_000;
const b64url = {
  encode: (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url'),
  decode: (text: string) => new Uint8Array(Buffer.from(text, 'base64url')),
};

/**
 * Passkeys for admins (WebAuthn, docs/security-plan.md, D2, X6). They are bound to the admin panel's own
 * address, so a look-alike site can't use one. Every request the browser answers is used once.
 */
@Injectable()
export class PasskeysService {
  private readonly rpID: string;
  private readonly origin: string;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    const panel = new URL(config.ADMIN_URL ?? 'http://localhost:3001');
    this.rpID = panel.hostname;
    this.origin = panel.origin;
  }

  /** The admin's passkeys, newest last. */
  list(adminId: string) {
    return this.db
      .select({
        id: adminPasskeys.id,
        name: adminPasskeys.name,
        createdAt: adminPasskeys.createdAt,
        lastUsedAt: adminPasskeys.lastUsedAt,
      })
      .from(adminPasskeys)
      .where(eq(adminPasskeys.adminId, adminId))
      .orderBy(asc(adminPasskeys.createdAt));
  }

  async has(adminId: string, db: Pick<Db, 'select'> = this.db) {
    const [row] = await db.select({ n: count() }).from(adminPasskeys).where(eq(adminPasskeys.adminId, adminId));
    return (row?.n ?? 0) > 0;
  }

  /** What the browser needs to make a new passkey for this admin. */
  async registrationOptions(adminId: string) {
    const [admin] = await this.db.select().from(admins).where(eq(admins.id, adminId));
    if (!admin) throw notFound('admin_not_found', 'Admin not found');
    const existing = await this.db
      .select({ id: adminPasskeys.credentialId, transports: adminPasskeys.transports })
      .from(adminPasskeys)
      .where(eq(adminPasskeys.adminId, adminId));
    const options = await generateRegistrationOptions({
      rpName: 'Jiffo Admin',
      rpID: this.rpID,
      userName: admin.email,
      userDisplayName: admin.name,
      userID: new TextEncoder().encode(admin.id),
      attestationType: 'none',
      excludeCredentials: existing.map((c) => ({ id: c.id, transports: c.transports })),
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
    });
    await this.remember(adminId, 'register', options.challenge);
    return options;
  }

  /** Keeps a passkey the browser just made, once its answer checks out. */
  async register(adminId: string, response: RegistrationResponseJSON, name: string) {
    let verified;
    try {
      verified = await verifyRegistrationResponse({
        response,
        expectedChallenge: (c) => this.waiting(adminId, 'register', c),
        expectedOrigin: this.origin,
        expectedRPID: this.rpID,
        requireUserVerification: true,
      });
    } catch {
      throw badRequest('passkey_invalid', "That passkey couldn't be checked. Try again.");
    }
    if (!verified.verified) throw badRequest('passkey_invalid', "That passkey couldn't be checked. Try again.");
    const { credential } = verified.registrationInfo;
    return this.db.transaction(async (tx) => {
      await this.use(tx, adminId, 'register', this.challengeOf(response.response.clientDataJSON));
      const [taken] = await tx
        .select({ id: adminPasskeys.id })
        .from(adminPasskeys)
        .where(eq(adminPasskeys.credentialId, credential.id));
      if (taken) throw conflict('passkey_exists', 'That passkey is already added');
      const [row] = await tx
        .insert(adminPasskeys)
        .values({
          adminId,
          credentialId: credential.id,
          publicKey: b64url.encode(credential.publicKey),
          counter: credential.counter,
          transports: credential.transports ?? [],
          name: name.trim() || 'Passkey',
        })
        .returning({ id: adminPasskeys.id, name: adminPasskeys.name });
      return row!;
    });
  }

  /** Removes one of the admin's passkeys. A role that needs one keeps at least one. */
  async remove(adminId: string, role: string, id: string) {
    return this.db.transaction(async (tx) => {
      const mine = await tx.select().from(adminPasskeys).where(eq(adminPasskeys.adminId, adminId)).for('update');
      if (!mine.some((p) => p.id === id)) throw notFound('passkey_not_found', 'No such passkey');
      if (needsPasskey(role) && mine.length === 1) {
        throw conflict('last_passkey', 'Add another passkey before removing this one: your role signs in with one');
      }
      await tx.delete(adminPasskeys).where(and(eq(adminPasskeys.id, id), eq(adminPasskeys.adminId, adminId)));
      return { removed: true };
    });
  }

  /** What the browser needs to sign in, or confirm, with one of this admin's passkeys. */
  async authenticationOptions(adminId: string, purpose: 'sign_in' | 'confirm') {
    const keys = await this.db
      .select({ id: adminPasskeys.credentialId, transports: adminPasskeys.transports })
      .from(adminPasskeys)
      .where(eq(adminPasskeys.adminId, adminId));
    if (!keys.length) throw conflict('no_passkey', 'Add a passkey first');
    const options = await generateAuthenticationOptions({
      rpID: this.rpID,
      allowCredentials: keys.map((k) => ({ id: k.id, transports: k.transports })),
      userVerification: 'required',
    });
    await this.remember(adminId, purpose, options.challenge);
    return options;
  }

  /**
   * Checks a passkey answer: one of this admin's own passkeys, for a request made to them and not used yet,
   * from the panel's address, with the person verified (PIN or biometric). The request is then used up.
   */
  async verify(tx: Tx, adminId: string, purpose: 'sign_in' | 'confirm', response: AuthenticationResponseJSON) {
    const [key] = await tx
      .select()
      .from(adminPasskeys)
      .where(and(eq(adminPasskeys.credentialId, response.id), eq(adminPasskeys.adminId, adminId)));
    if (!key) return false;
    let result;
    try {
      result = await verifyAuthenticationResponse({
        response,
        expectedChallenge: (c) => this.waiting(adminId, purpose, c, tx),
        expectedOrigin: this.origin,
        expectedRPID: this.rpID,
        credential: {
          id: key.credentialId,
          publicKey: b64url.decode(key.publicKey),
          counter: key.counter,
          transports: key.transports,
        },
        requireUserVerification: true,
      });
    } catch {
      return false;
    }
    if (!result.verified) return false;
    if (!(await this.use(tx, adminId, purpose, this.challengeOf(response.response.clientDataJSON), false))) {
      return false;
    }
    await tx
      .update(adminPasskeys)
      .set({ counter: result.authenticationInfo.newCounter, lastUsedAt: new Date() })
      .where(eq(adminPasskeys.id, key.id));
    return true;
  }

  private challengeOf(clientDataJSON: string) {
    try {
      return (JSON.parse(Buffer.from(clientDataJSON, 'base64url').toString('utf8')) as { challenge?: string })
        .challenge;
    } catch {
      return undefined;
    }
  }

  private async remember(adminId: string, purpose: Purpose, challenge: string) {
    await this.db
      .insert(adminPasskeyChallenges)
      .values({ adminId, purpose, challenge, expiresAt: new Date(Date.now() + CHALLENGE_MS) });
  }

  /** Whether this challenge was given to this admin for this purpose, and is still waiting to be used. */
  private async waiting(adminId: string, purpose: Purpose, challenge: string, db: Pick<Db, 'select'> = this.db) {
    const [row] = await db
      .select({ id: adminPasskeyChallenges.id })
      .from(adminPasskeyChallenges)
      .where(
        and(
          eq(adminPasskeyChallenges.adminId, adminId),
          eq(adminPasskeyChallenges.purpose, purpose),
          eq(adminPasskeyChallenges.challenge, challenge),
          isNull(adminPasskeyChallenges.usedAt),
          gt(adminPasskeyChallenges.expiresAt, new Date()),
        ),
      );
    return !!row;
  }

  /** Uses a challenge up, in the same statement that checks it is unused, so an answer can't count twice. */
  private async use(tx: Tx, adminId: string, purpose: Purpose, challenge: string | undefined, raise = true) {
    const [used] = challenge
      ? await tx
          .update(adminPasskeyChallenges)
          .set({ usedAt: new Date() })
          .where(
            and(
              eq(adminPasskeyChallenges.adminId, adminId),
              eq(adminPasskeyChallenges.purpose, purpose),
              eq(adminPasskeyChallenges.challenge, challenge),
              isNull(adminPasskeyChallenges.usedAt),
              gt(adminPasskeyChallenges.expiresAt, new Date()),
            ),
          )
          .returning({ id: adminPasskeyChallenges.id })
      : [];
    if (!used && raise) throw unauthorized('passkey_expired', 'That passkey request has expired. Try again.');
    return !!used;
  }
}
