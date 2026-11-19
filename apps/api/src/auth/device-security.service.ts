import { createHash, createHmac, createPublicKey, randomBytes, timingSafeEqual, verify } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, isNull, lt } from 'drizzle-orm';
import { DEFAULT_SECURITY_SETTINGS } from '@jiffo/shared';
import { badRequest, conflict, forbidden } from '../common/errors';
import { subKey } from '../common/keys';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { CountriesService } from '../countries/countries.service';
import { DB, type Db } from '../db/database.module';
import { deviceChallenges, devices, sessions, users } from '../db/schema';
import { WithdrawalHoldsService } from '../money/withdrawal-holds.service';
import type { AuthContext } from './auth.types';

/** How long a phone has to sign over a code the server gave it. */
const CHALLENGE_TTL_MS = 2 * 60_000;
/** A phone's key, and a PIN reset without the old PIN, are taken only this soon after a fresh sign-in. */
export const FRESH_SIGN_IN_MS = 10 * 60_000;

/** The headers a signed money request carries (docs/security-plan.md, A3, A7). */
export const SIGNED_HEADERS = { nonce: 'x-jiffo-nonce', signature: 'x-jiffo-signature', pin: 'x-jiffo-pin' } as const;

/**
 * What a phone signs for a money request: the server's single-use code, the method and path, and a hash of
 * the body, one per line. The app builds the same string (apps/mobile/src/auth/device-key.ts).
 */
export const signedPayload = (nonce: string, method: string, path: string, body: Buffer | string | undefined) =>
  [
    nonce,
    method.toUpperCase(),
    path,
    createHash('sha256')
      .update(body ?? '')
      .digest('hex'),
  ].join('\n');

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

/** Four digits, not all the same and not a run such as 1234 or 9876. */
function weakPin(pin: string) {
  const d = [...pin].map(Number);
  const step = d[1]! - d[0]!;
  return new Set(d).size === 1 || ((step === 1 || step === -1) && d.every((n, i) => i === 0 || n - d[i - 1]! === step));
}

/**
 * The phone's own key and the app PIN (docs/security-plan.md, A3, A5, A7). Money actions are signed by a key
 * made in the phone's secure hardware, over a single-use code from the server, and carry the app PIN, which
 * the server checks: an SMS code alone never moves money.
 */
@Injectable()
export class DeviceSecurityService {
  private readonly pinKey: Buffer;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(APP_CONFIG) config: AppConfig,
    private readonly countries: CountriesService,
    private readonly holds: WithdrawalHoldsService,
  ) {
    this.pinKey = subKey(Buffer.from(config.PIN_KEY, 'hex'), 'jiffo app pin');
  }

  /** What the app needs to know to guide the person: a key on this phone, a PIN, and whether it's locked. */
  async status(auth: AuthContext) {
    const [[device], [user]] = await Promise.all([
      this.db.select({ key: devices.publicKey }).from(devices).where(eq(devices.id, auth.deviceId)),
      this.db
        .select({ hash: users.appPinHash, locked: users.appPinLockedAt })
        .from(users)
        .where(eq(users.id, auth.userId)),
    ]);
    return { deviceKey: !!device?.key, hasPin: !!user?.hash, pinLocked: !!user?.locked };
  }

  /** The sign-in this session began with was in the last few minutes. */
  private async fresh(auth: AuthContext) {
    const [session] = await this.db
      .select({ createdAt: sessions.createdAt })
      .from(sessions)
      .where(eq(sessions.id, auth.sessionId));
    return !!session && Date.now() - session.createdAt.getTime() <= FRESH_SIGN_IN_MS;
  }

  /**
   * Keeps this phone's public key. Once per phone, and only just after signing in: a stolen session can't
   * swap in a key of its own. A new install is a new phone, with a new sign-in.
   */
  async registerKey(auth: AuthContext, publicKey: string) {
    let spki: string;
    try {
      const key = createPublicKey({ key: Buffer.from(publicKey, 'base64'), format: 'der', type: 'spki' });
      if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') throw new Error();
      spki = key.export({ type: 'spki', format: 'der' }).toString('base64');
    } catch {
      throw badRequest('key_invalid', "This phone's key isn't one Jiffo can use");
    }
    if (!(await this.fresh(auth))) {
      throw forbidden('sign_in_again', 'Sign in again on this phone to set it up for money actions');
    }
    const [set] = await this.db
      .update(devices)
      .set({ publicKey: spki, keyAddedAt: new Date() })
      .where(and(eq(devices.id, auth.deviceId), isNull(devices.publicKey)))
      .returning({ id: devices.id });
    if (!set) throw conflict('key_exists', 'This phone is already set up');
  }

  /** A single-use code for the phone to sign a money request over. */
  async challenge(auth: AuthContext) {
    const nonce = randomBytes(32).toString('base64url');
    const now = Date.now();
    await this.db.insert(deviceChallenges).values({
      deviceId: auth.deviceId,
      nonceHash: sha256(nonce),
      expiresAt: new Date(now + CHALLENGE_TTL_MS),
    });
    // Old codes for this phone go, so the table stays small.
    await this.db
      .delete(deviceChallenges)
      .where(and(eq(deviceChallenges.deviceId, auth.deviceId), lt(deviceChallenges.expiresAt, new Date(now - 60_000))));
    return { nonce, expiresInSeconds: CHALLENGE_TTL_MS / 1000 };
  }

  /**
   * Checks a signed request: this phone's key over a code the server gave it, used once, then the app PIN
   * when the action needs it. The signature comes first, so guessing the PIN needs the phone.
   */
  async verify(
    auth: AuthContext,
    request: { method: string; path: string; body: Buffer | undefined; nonce?: string; signature?: string },
    pin: string | undefined | false,
  ) {
    const [device] = await this.db
      .select({ key: devices.publicKey })
      .from(devices)
      .where(eq(devices.id, auth.deviceId));
    if (!device?.key) throw forbidden('device_key_needed', 'Set up this phone for money actions first');
    if (!request.nonce || !request.signature) throw forbidden('signature_needed', 'Confirm this on your phone');
    // Used up whether or not the rest passes: a code is good for one try.
    const [used] = await this.db
      .update(deviceChallenges)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(deviceChallenges.nonceHash, sha256(request.nonce)),
          eq(deviceChallenges.deviceId, auth.deviceId),
          isNull(deviceChallenges.usedAt),
          gt(deviceChallenges.expiresAt, new Date()),
        ),
      )
      .returning({ id: deviceChallenges.id });
    if (!used) throw forbidden('challenge_invalid', 'That confirmation has expired. Try again.');
    let ok = false;
    try {
      ok = verify(
        'sha256',
        Buffer.from(signedPayload(request.nonce, request.method, request.path, request.body)),
        {
          key: createPublicKey({ key: Buffer.from(device.key, 'base64'), format: 'der', type: 'spki' }),
          dsaEncoding: 'der',
        },
        Buffer.from(request.signature, 'base64'),
      );
    } catch {
      ok = false;
    }
    if (!ok) throw forbidden('signature_invalid', "This request wasn't signed by this phone");
    if (pin !== false) await this.checkPin(auth, pin);
  }

  private hashPin(pin: string, salt = randomBytes(16).toString('hex')) {
    return `${salt}:${createHmac('sha256', this.pinKey).update(`${salt}:${pin}`).digest('hex')}`;
  }

  private pinMatches(stored: string, pin: string) {
    const [salt] = stored.split(':');
    const a = Buffer.from(this.hashPin(pin, salt));
    const b = Buffer.from(stored);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private async pinTries(countryCode: string) {
    const saved = await this.countries.currentSettingsIfAny(countryCode);
    return saved?.settings.security?.appPinTries ?? DEFAULT_SECURITY_SETTINGS.appPinTries;
  }

  /**
   * The app PIN, checked on the server. Wrong ones are counted, and at the limit in Settings, Security it
   * locks until the person signs in again and sets a new one. The count is kept even though the request fails.
   */
  private async checkPin(auth: AuthContext, pin: string | undefined) {
    const outcome = await this.db.transaction(async (tx) => {
      const [user] = await tx
        .select({
          hash: users.appPinHash,
          failures: users.appPinFailures,
          locked: users.appPinLockedAt,
          countryCode: users.countryCode,
        })
        .from(users)
        .where(eq(users.id, auth.userId))
        .for('update');
      if (!user?.hash) return { error: forbidden('pin_needed', 'Set your app PIN first') };
      if (user.locked) return { error: pinLocked() };
      if (!pin) return { error: badRequest('pin_missing', 'Enter your app PIN') };
      if (this.pinMatches(user.hash, pin)) {
        if (user.failures) await tx.update(users).set({ appPinFailures: 0 }).where(eq(users.id, auth.userId));
        return { error: null };
      }
      const failures = user.failures + 1;
      const tries = await this.pinTries(user.countryCode);
      const locks = failures >= tries;
      await tx
        .update(users)
        .set({ appPinFailures: failures, ...(locks ? { appPinLockedAt: new Date() } : {}) })
        .where(eq(users.id, auth.userId));
      return {
        error: locks ? pinLocked() : forbidden('pin_wrong', 'Wrong PIN', { triesLeft: tries - failures }),
      };
    });
    if (outcome.error) throw outcome.error;
  }

  /**
   * Sets the app PIN. The first needs nothing more. Changing one needs the current PIN; without it, as when it
   * is forgotten or locked, only just after a fresh sign-in on this phone. Either change pauses withdrawals
   * (A6), since a new PIN is how someone who took the number over would get in.
   */
  async setPin(auth: AuthContext, input: { pin: string; currentPin?: string }) {
    if (!/^\d{4}$/.test(input.pin)) throw badRequest('pin_invalid', 'Your PIN is 4 digits');
    if (weakPin(input.pin)) throw badRequest('pin_weak', 'Choose a PIN that is harder to guess');
    const [user] = await this.db
      .select({ hash: users.appPinHash, locked: users.appPinLockedAt })
      .from(users)
      .where(eq(users.id, auth.userId));
    if (user?.hash) {
      if (input.currentPin !== undefined) {
        if (user.locked) throw pinLocked();
        await this.checkPin(auth, input.currentPin);
      } else if (!(await this.fresh(auth))) {
        throw forbidden('sign_in_again', 'Sign in again on this phone to set a new PIN');
      }
    }
    const changed = !!user?.hash;
    const until = await this.db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ appPinHash: this.hashPin(input.pin), appPinSetAt: new Date(), appPinFailures: 0, appPinLockedAt: null })
        .where(eq(users.id, auth.userId));
      return changed ? this.holds.start(tx, auth.userId, 'pin') : null;
    });
    if (until) await this.holds.tell(auth.userId, 'pin', until);
    return { set: true, withdrawalsHeldUntil: until?.toISOString() ?? null };
  }
}

const pinLocked = () =>
  forbidden('pin_locked', 'Your PIN is locked after too many wrong tries. Sign in again to set a new one.');
