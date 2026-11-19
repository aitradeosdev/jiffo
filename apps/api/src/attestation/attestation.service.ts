import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, gt, isNull, lt } from 'drizzle-orm';
import { DEFAULT_SECURITY_SETTINGS } from '@jiffo/shared';
import { badRequest, forbidden } from '../common/errors';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { CountriesService } from '../countries/countries.service';
import { DB, type Db } from '../db/database.module';
import { appAttestKeys, attestationChallenges, deviceAttestations, devices, type AppName } from '../db/schema';
import type { AuthContext } from '../auth/auth.types';
import { AppAttestError, verifyAssertion, verifyKeyAttestation } from './app-attest';
import {
  attestedHash,
  RISK_LABELS,
  type AttestationCheck,
  type AttestEvidence,
  type AttestPurpose,
  type Verdict,
} from './attestation.types';
import { PlayIntegrityUnavailable, PlayIntegrityVerifier } from './play-integrity';

/** How long the app has to use a code. */
const CHALLENGE_TTL_MS = 5 * 60_000;
const VERDICTS: readonly Verdict[] = ['trusted', 'doubtful', 'failed', 'missing', 'unavailable'];

export interface AttestContext {
  purpose: AttestPurpose;
  /** The install's own key (devices.device_key). */
  deviceKey: string;
  platform: 'ios' | 'android' | 'web';
  app: AppName;
  userId: string | null;
  countryCode: string;
  request: { method: string; path: string; body: Buffer | undefined };
  evidence: AttestEvidence;
}

const sha256hex = (text: string) => createHash('sha256').update(text).digest('hex');

type AttestMode = 'off' | 'record' | 'enforce';

const refusal = (verdict: Verdict) =>
  forbidden(
    'attestation_failed',
    "This needs the Jiffo app from the App Store or Google Play, on a phone that hasn't been changed",
    { verdict },
  );

/**
 * App attestation (docs/security-plan.md, MB3): Google Play Integrity on Android and Apple App Attest on iOS
 * show a request comes from our store app on a real phone, over a single-use code from the server. Each
 * result is kept. In Settings, Security: record keeps them only; enforce refuses a failed or missing one and
 * hands back a doubtful one, for the caller to ask for a selfie.
 */
@Injectable()
export class AttestationService {
  private readonly logger = new Logger('Attestation');
  private readonly play: PlayIntegrityVerifier | null;
  private readonly appIds: Readonly<Record<AppName, string>> | null;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly countries: CountriesService,
  ) {
    this.play = config.PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON
      ? new PlayIntegrityVerifier(
          config.PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON,
          { customer: config.ANDROID_PACKAGE_CUSTOMER, agent: config.ANDROID_PACKAGE_AGENT },
          (config.ANDROID_CERT_SHA256 ?? '')
            .split(',')
            .map((d) => d.trim())
            .filter(Boolean),
        )
      : null;
    this.appIds = config.APPLE_TEAM_ID
      ? {
          customer: `${config.APPLE_TEAM_ID}.${config.IOS_BUNDLE_ID_CUSTOMER}`,
          agent: `${config.APPLE_TEAM_ID}.${config.IOS_BUNDLE_ID_AGENT}`,
        }
      : null;
  }

  private production() {
    return this.config.NODE_ENV === 'production';
  }

  async mode(countryCode: string): Promise<AttestMode> {
    const saved = await this.countries.currentSettingsIfAny(countryCode);
    return saved?.settings.security?.attestation ?? DEFAULT_SECURITY_SETTINGS.attestation;
  }

  /** A single-use code for this install to make an attestation over. */
  async challenge(deviceKey: string) {
    const nonce = randomBytes(32).toString('base64url');
    const now = Date.now();
    await this.db
      .insert(attestationChallenges)
      .values({ deviceKey, nonceHash: sha256hex(nonce), expiresAt: new Date(now + CHALLENGE_TTL_MS) });
    // Codes long past their time go, whichever install they were for, so the table stays small.
    await this.db.delete(attestationChallenges).where(lt(attestationChallenges.expiresAt, new Date(now - 60_000)));
    return { nonce, expiresInSeconds: CHALLENGE_TTL_MS / 1000 };
  }

  /** Uses up a code given to this install; false when it isn't one, has expired or was used. */
  private async consume(deviceKey: string, nonce: string) {
    const [used] = await this.db
      .update(attestationChallenges)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(attestationChallenges.nonceHash, sha256hex(nonce)),
          eq(attestationChallenges.deviceKey, deviceKey),
          isNull(attestationChallenges.usedAt),
          gt(attestationChallenges.expiresAt, new Date()),
        ),
      )
      .returning({ id: attestationChallenges.id });
    return !!used;
  }

  /**
   * An iPhone's new App Attest key, which Apple attested for our code: kept for its assertions. Once per key,
   * made when the app first needs one; an install may have several.
   */
  async registerAppleKey(input: {
    deviceKey: string;
    app: AppName;
    keyId: string;
    attestation: string;
    nonce: string;
  }) {
    if (!this.appIds) throw forbidden('attestation_unavailable', "App checks aren't set up for iPhones yet");
    if (!(await this.consume(input.deviceKey, input.nonce))) {
      throw forbidden('attestation_challenge_invalid', 'That check has expired. Try again.');
    }
    let key;
    try {
      key = verifyKeyAttestation({
        attestation: Buffer.from(input.attestation, 'base64'),
        keyId: input.keyId,
        clientDataHash: createHash('sha256').update(input.nonce).digest(),
        appIds: [this.appIds[input.app]],
      });
    } catch (error) {
      if (error instanceof AppAttestError) throw badRequest('attestation_invalid', "This app couldn't be checked");
      throw error;
    }
    await this.db
      .insert(appAttestKeys)
      .values({ deviceKey: input.deviceKey, keyId: input.keyId, ...key })
      .onConflictDoNothing({ target: appAttestKeys.keyId });
  }

  /**
   * The verdict on a request's evidence, kept for staff. What the app found on the phone (MB4) makes a
   * trusted phone doubtful, and is kept as the device's latest.
   */
  async check(ctx: AttestContext): Promise<AttestationCheck> {
    const signals = ctx.evidence.signals ?? [];
    const judged = await this.judge(ctx);
    const result: AttestationCheck = signals.length
      ? {
          verdict: judged.verdict === 'trusted' ? 'doubtful' : judged.verdict,
          reasons: [...judged.reasons, ...signals.map((s) => RISK_LABELS[s])],
        }
      : judged;
    await this.db
      .update(devices)
      .set({ riskSignals: signals, riskSignalsAt: new Date() })
      .where(and(eq(devices.deviceKey, ctx.deviceKey), eq(devices.app, ctx.app)));
    await this.db.insert(deviceAttestations).values({
      signals,
      deviceKey: ctx.deviceKey,
      userId: ctx.userId,
      app: ctx.app,
      platform: ctx.platform,
      purpose: ctx.purpose,
      verdict: result.verdict,
      reasons: result.reasons,
    });
    return result;
  }

  /**
   * Checks a request as Settings, Security says. Off: nothing. Record: checked alongside and kept, never
   * waited for or refused. Enforce: a failed, missing or unavailable one is refused, and a doubtful one is
   * returned as such, for the caller to ask for more (a selfie). Otherwise the answer is trusted.
   */
  async enforce(ctx: AttestContext, known?: AttestMode): Promise<'trusted' | 'doubtful'> {
    const mode = known ?? (await this.mode(ctx.countryCode));
    if (mode === 'off') return 'trusted';
    if (mode === 'record') {
      void this.check(ctx).catch((error: unknown) => this.logger.warn(`Check not recorded: ${String(error)}`));
      return 'trusted';
    }
    const { verdict, reasons } = await this.check(ctx);
    if (verdict === 'trusted' || verdict === 'doubtful') return verdict;
    this.logger.warn(`Refused ${ctx.purpose} on ${ctx.platform}: ${verdict} ${reasons.join('; ')}`);
    throw refusal(verdict);
  }

  /** As enforce, for a signed-in session: its phone's install key and platform come from its device. */
  async enforceSession(
    auth: AuthContext,
    purpose: AttestPurpose,
    attest: Pick<AttestContext, 'evidence' | 'request'>,
  ): Promise<'trusted' | 'doubtful'> {
    const mode = await this.mode(auth.countryCode);
    if (mode === 'off') return 'trusted';
    const [device] = await this.db
      .select({ deviceKey: devices.deviceKey, platform: devices.platform })
      .from(devices)
      .where(eq(devices.id, auth.deviceId));
    if (!device) {
      if (mode === 'enforce') throw refusal('missing');
      return 'trusted';
    }
    return this.enforce(
      { purpose, ...device, app: auth.app, userId: auth.userId, countryCode: auth.countryCode, ...attest },
      mode,
    );
  }

  private async judge(ctx: AttestContext): Promise<AttestationCheck> {
    const { nonce, token, keyId } = ctx.evidence;
    if (!nonce || !token) return { verdict: 'missing', reasons: [] };
    if (!(await this.consume(ctx.deviceKey, nonce))) return { verdict: 'failed', reasons: ['Expired or used code'] };
    const hash = attestedHash(nonce, ctx.request.method, ctx.request.path, ctx.request.body);

    // Development and tests: a stand-in that says what it's told, never in production.
    if (!this.production() && token.startsWith('fake:')) {
      const verdict = token.slice(5) as Verdict;
      return VERDICTS.includes(verdict)
        ? { verdict, reasons: ['Development stand-in'] }
        : { verdict: 'failed', reasons: [] };
    }
    if (ctx.platform === 'android') {
      if (!this.play) return { verdict: 'unavailable', reasons: ['Play Integrity not set up'] };
      try {
        return await this.play.verify(token, hash.toString('hex'), ctx.app);
      } catch (error) {
        if (error instanceof PlayIntegrityUnavailable) {
          this.logger.warn(error.message);
          return { verdict: 'doubtful', reasons: ["Google couldn't be asked"] };
        }
        throw error;
      }
    }
    if (ctx.platform === 'ios') return this.assertion(ctx, token, keyId, hash);
    return { verdict: 'unavailable', reasons: ['No attestation on the web'] };
  }

  private async assertion(ctx: AttestContext, token: string, keyId: string | undefined, hash: Buffer) {
    if (!this.appIds) return { verdict: 'unavailable' as const, reasons: ['App Attest not set up'] };
    if (!keyId) return { verdict: 'missing' as const, reasons: ['No key'] };
    const [key] = await this.db
      .select()
      .from(appAttestKeys)
      .where(and(eq(appAttestKeys.keyId, keyId), eq(appAttestKeys.deviceKey, ctx.deviceKey)));
    if (!key || key.appId !== this.appIds[ctx.app]) return { verdict: 'failed' as const, reasons: ['Unknown key'] };
    let counter: number;
    try {
      counter = verifyAssertion({
        assertion: Buffer.from(token, 'base64'),
        clientDataHash: hash,
        publicKey: key.publicKey,
        counter: key.counter,
        appId: key.appId,
      });
    } catch (error) {
      if (error instanceof AppAttestError) return { verdict: 'failed' as const, reasons: [error.message] };
      throw error;
    }
    // Moved on only past the counter seen, so two requests with one assertion can't both pass.
    const [moved] = await this.db
      .update(appAttestKeys)
      .set({ counter, lastUsedAt: new Date() })
      .where(and(eq(appAttestKeys.id, key.id), lt(appAttestKeys.counter, counter)))
      .returning({ id: appAttestKeys.id });
    if (!moved) return { verdict: 'failed' as const, reasons: ['Used before'] };
    // A development build's key, talking to production.
    if (key.development && this.production()) {
      return { verdict: 'doubtful' as const, reasons: ['A development build'] };
    }
    return { verdict: 'trusted' as const, reasons: [] };
  }
}
