import {
  bigint,
  bigserial,
  boolean,
  char,
  check,
  cidr,
  customType,
  doublePrecision,
  index,
  primaryKey,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { encrypted } from './fields';
import {
  ADMIN_ROLES,
  AGENT_TIERS,
  APPROVAL_KINDS,
  APPROVAL_STATUSES,
  RISK_FLAG_KINDS,
  RISK_FLAG_STATUSES,
  RISK_QUEUES,
  WITHDRAWAL_HOLD_REASONS,
  type AdminRole,
  type CountrySettings,
  type ErrandState,
  type PriceOverride,
  type Prices,
} from '@jiffo/shared';

/** PostGIS point (longitude, latitude). Written with ST_MakePoint, read back through the lat/lng columns. */
const geographyPoint = customType<{ data: string; driverData: string }>({
  dataType: () => 'geography(Point, 4326)',
});

/**
 * A drawn boundary: one or more polygons (longitude, latitude). Written with ST_GeomFromGeoJSON, read back with
 * ST_AsGeoJSON.
 */
const boundaryShape = customType<{ data: string; driverData: string }>({
  dataType: () => 'geometry(MultiPolygon, 4326)',
});

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();
const kobo = (name: string) => bigint(name, { mode: 'number' });

/* ---------- Country adapter ---------- */

export const countries = pgTable('countries', {
  code: char('code', { length: 2 }).primaryKey(),
  name: text('name').notNull(),
  currency: char('currency', { length: 3 }).notNull(),
  phonePrefix: text('phone_prefix').notNull(),
  timezone: text('timezone').notNull(),
  enabled: boolean('enabled').notNull().default(false),
});

export const states = pgTable(
  'states',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    countryCode: char('country_code', { length: 2 })
      .notNull()
      .references(() => countries.code),
    code: text('code').notNull(),
    name: text('name').notNull(),
    enabled: boolean('enabled').notNull().default(false),
    agentSignups: text('agent_signups', { enum: ['open', 'waitlist'] })
      .notNull()
      .default('open'),
  },
  (t) => [uniqueIndex('states_country_code_uq').on(t.countryCode, t.code)],
);

/**
 * A city in a state, drawn by admin on a map. Errands are taken only in its areas, and only while the city, its
 * state and its country are switched on.
 */
export const cities = pgTable(
  'cities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    stateId: uuid('state_id')
      .notNull()
      .references(() => states.id),
    name: text('name').notNull(),
    enabled: boolean('enabled').notNull().default(false),
    boundary: boundaryShape('boundary').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('cities_state_name_uq').on(t.stateId, sql`lower(${t.name})`),
    index('cities_boundary_gix').using('gist', t.boundary),
  ],
);

/** An area in a city, drawn by admin: where errands are taken while it is switched on. Areas in a city never overlap. */
export const areas = pgTable(
  'areas',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    cityId: uuid('city_id')
      .notNull()
      .references(() => cities.id),
    name: text('name').notNull(),
    enabled: boolean('enabled').notNull().default(false),
    boundary: boundaryShape('boundary').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('areas_city_name_uq').on(t.cityId, sql`lower(${t.name})`),
    index('areas_boundary_gix').using('gist', t.boundary),
  ],
);

/**
 * Prices a state, city or area sets for itself (Settings, Places): each change is a new version, the highest
 * current; what one leaves out comes from the level above. Changed only with a second admin's approval.
 */
export const priceOverrides = pgTable(
  'price_overrides',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    scope: text('scope', { enum: ['state', 'city', 'area'] }).notNull(),
    scopeId: uuid('scope_id').notNull(),
    countryCode: char('country_code', { length: 2 })
      .notNull()
      .references(() => countries.code),
    version: integer('version').notNull(),
    data: jsonb('data').$type<PriceOverride>().notNull(),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('price_overrides_scope_version_uq').on(t.scope, t.scopeId, t.version)],
);

/** Every saved change to a country's settings is a new version; the highest version is current. */
export const settingsVersions = pgTable(
  'settings_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    countryCode: char('country_code', { length: 2 })
      .notNull()
      .references(() => countries.code),
    version: integer('version').notNull(),
    data: jsonb('data').$type<CountrySettings>().notNull(),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('settings_country_version_uq').on(t.countryCode, t.version)],
);

export const categories = pgTable(
  'categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    countryCode: char('country_code', { length: 2 })
      .notNull()
      .references(() => countries.code),
    key: text('key').notNull(),
    name: text('name').notNull(),
    icon: text('icon').notNull(),
    description: text('description').notNull().default(''),
    buyDefault: boolean('buy_default').notNull().default(false),
    sort: integer('sort').notNull().default(0),
    active: boolean('active').notNull().default(true),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('categories_country_key_uq')
      .on(t.countryCode, t.key)
      .where(sql`${t.deletedAt} is null`),
  ],
);

/* ---------- Accounts and sessions ---------- */

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    phone: text('phone').notNull().unique(),
    countryCode: char('country_code', { length: 2 })
      .notNull()
      .references(() => countries.code),
    firstName: text('first_name'),
    lastName: text('last_name'),
    email: text('email'),
    status: text('status', { enum: ['active', 'suspended'] })
      .notNull()
      .default('active'),
    /**
     * Agents' withdrawals wait until then after a change to the account: a new payout account or a sign-in
     * on a new phone (docs/security-plan.md, A6). Never moved earlier by a later change.
     */
    withdrawalsHeldUntil: timestamp('withdrawals_held_until', { withTimezone: true }),
    /** What started the hold, for the agent and support. */
    withdrawalsHeldFor: text('withdrawals_held_for', { enum: WITHDRAWAL_HOLD_REASONS }),
    /**
     * The app PIN money actions need (docs/security-plan.md, A7): "salt:hash", a keyed hash, never the PIN.
     * Checked by the server alongside the phone's signature, so guessing it needs the phone.
     */
    appPinHash: text('app_pin_hash'),
    appPinSetAt: timestamp('app_pin_set_at', { withTimezone: true }),
    /** Wrong PINs in a row; at the limit in Settings, Security, it locks until reset by a fresh sign-in. */
    appPinFailures: integer('app_pin_failures').notNull().default(0),
    appPinLockedAt: timestamp('app_pin_locked_at', { withTimezone: true }),
    /** Agents' selfie checks failed in a row; at identity.selfieTries the account is suspended for review (I8). */
    selfieFailures: integer('selfie_failures').notNull().default(0),
    /** A selfie check asked for at random when going online, until one passes (I8). */
    selfieDue: boolean('selfie_due').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  // The admin People list: a country's accounts, newest first.
  (t) => [index('users_country_created_idx').on(t.countryCode, t.createdAt, t.id)],
);

export const APPS = ['customer', 'agent'] as const;
export type AppName = (typeof APPS)[number];

/** A phone running one of the apps. Sessions and push tokens hang off it. */
export const devices = pgTable(
  'devices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    deviceKey: text('device_key').notNull(),
    app: text('app', { enum: APPS }).notNull(),
    platform: text('platform', { enum: ['ios', 'android', 'web'] }).notNull(),
    name: text('name'),
    pushToken: text('push_token'),
    pushUpdatedAt: timestamp('push_updated_at', { withTimezone: true }),
    /**
     * The phone's own key (docs/security-plan.md, A3): the public half of a P-256 key made in the Secure
     * Enclave or Android Keystore, as base64 SPKI. Money requests from this phone are signed with it.
     */
    publicKey: text('public_key'),
    keyAddedAt: timestamp('key_added_at', { withTimezone: true }),
    /**
     * Set when its owner signed out and asked to forget it, handing it on: signing in on it again counts as a
     * new phone, with the withdrawal hold (A6). Cleared by that sign-in.
     */
    forgottenAt: timestamp('forgotten_at', { withTimezone: true }),
    /**
     * A phone the agent signed in on that isn't the one they signed up on: money actions on it need a passed
     * selfie check there first (docs/security-plan.md, A4, X4).
     */
    selfieNeeded: boolean('selfie_needed').notNull().default(false),
    /**
     * Why it's needed, for what the app tells the agent: a new phone, or a sign-in a check doubted (MB3, A10).
     * Empty on phones from before it was kept, which were new phones.
     */
    selfieFor: text('selfie_for').$type<PhoneSelfieReason>(),
    /** What the app last found on this phone (MB4): root, an emulator, hooking tools, a debugger. */
    riskSignals: jsonb('risk_signals').$type<string[]>().notNull().default([]),
    riskSignalsAt: timestamp('risk_signals_at', { withTimezone: true }),
    /**
     * How risky the latest sign-in on this device looked, and why (docs/security-plan.md, A10): the app's signals,
     * a phone several accounts have used, a VPN, a cloud provider's address. A high one asks for more checks.
     */
    signInRiskScore: smallint('sign_in_risk_score').notNull().default(0),
    signInRiskReasons: jsonb('sign_in_risk_reasons').$type<string[]>().notNull().default([]),
    /**
     * A keyed hash of the phone's own id, the same in both apps on one phone (iOS's id for the vendor,
     * Android's id for apps signed with one key), so accounts sharing a phone can be flagged (I3, E6). The id
     * itself is never kept.
     */
    phoneFingerprint: text('phone_fingerprint'),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('devices_user_key_app_uq').on(t.userId, t.deviceKey, t.app),
    // Other accounts on the same phone, for the shared-phone flags.
    index('devices_key_idx').on(t.deviceKey),
    index('devices_phone_fingerprint_idx').on(t.phoneFingerprint),
    index('devices_public_key_idx').on(t.publicKey),
  ],
);

/** Single-use codes a phone signs a money request over (A3): issued by the server, used once, short-lived. */
export const deviceChallenges = pgTable(
  'device_challenges',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => devices.id),
    /** Only the hash of the code is kept. */
    nonceHash: text('nonce_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('device_challenges_nonce_uq').on(t.nonceHash),
    index('device_challenges_device_idx').on(t.deviceId),
    // Clearing old codes, for every phone.
    index('device_challenges_expires_idx').on(t.expiresAt),
  ],
);

/* ---------- App attestation (docs/security-plan.md, MB3) ---------- */

/**
 * A single-use code an attestation is made over: given to this install (its device key, which also names it
 * before sign-in), good for a few minutes, used once.
 */
export const attestationChallenges = pgTable(
  'attestation_challenges',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** The install's own key (devices.device_key), not a device row: sign-in asks before there is one. */
    deviceKey: text('device_key').notNull(),
    /** Only the hash of the code is kept. */
    nonceHash: text('nonce_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('attestation_challenges_nonce_uq').on(t.nonceHash),
    index('attestation_challenges_expires_idx').on(t.expiresAt),
  ],
);

/**
 * A key an iPhone made in its Secure Enclave and Apple attested as our app's (App Attest). Each assertion
 * after counts up, so none is used twice. An install may have several; none replaces another.
 */
export const appAttestKeys = pgTable(
  'app_attest_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    deviceKey: text('device_key').notNull(),
    /** Apple's id for the key, base64. */
    keyId: text('key_id').notNull(),
    /** TEAMID.bundle.id */
    appId: text('app_id').notNull(),
    publicKey: text('public_key').notNull(),
    counter: integer('counter').notNull().default(0),
    /** Attested in Apple's development environment: a development build. */
    development: boolean('development').notNull().default(false),
    createdAt: createdAt(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('app_attest_keys_key_uq').on(t.keyId), index('app_attest_keys_device_idx').on(t.deviceKey)],
);

/** Each attestation checked: for staff, and as a risk signal (MB4). Only the verdict and why, no token. */
export const deviceAttestations = pgTable(
  'device_attestations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    deviceKey: text('device_key').notNull(),
    userId: uuid('user_id').references(() => users.id),
    app: text('app', { enum: APPS }).notNull(),
    platform: text('platform', { enum: ['ios', 'android', 'web'] }).notNull(),
    purpose: text('purpose', { enum: ['sign_in', 'withdrawal', 'payout_account', 'go_online'] }).notNull(),
    verdict: text('verdict', { enum: ['trusted', 'doubtful', 'failed', 'missing', 'unavailable'] }).notNull(),
    reasons: jsonb('reasons').$type<string[]>().notNull().default([]),
    /** What the app found on the phone (MB4). */
    signals: jsonb('signals').$type<string[]>().notNull().default([]),
    createdAt: createdAt(),
  },
  (t) => [
    index('device_attestations_device_idx').on(t.deviceKey, t.createdAt),
    index('device_attestations_user_idx').on(t.userId, t.createdAt),
  ],
);

/**
 * What asks an agent for a selfie: the day's first time online, a random check, a new phone, a payout change,
 * or a phone the app check (MB3) doubts.
 */
export const SELFIE_REASONS = ['daily', 'random', 'new_device', 'payout_change', 'device_check'] as const;
export type SelfieReason = (typeof SELFIE_REASONS)[number];
/** What asks for a selfie on one phone before money actions on it. */
export type PhoneSelfieReason = Extract<SelfieReason, 'new_device' | 'device_check'>;

/**
 * An agent's selfie check against the face their identity provider kept from their first check (Smile ID's
 * SmartSelfie Authentication): once a day before going online, now and then at random, and on a new phone
 * before money actions, and just before a payout account changes (docs/security-plan.md, A4, I8, P8). Only the
 * outcome is kept, never the selfie.
 */
export const agentSelfieChecks = pgTable(
  'agent_selfie_checks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    /** The phone it was taken on. */
    deviceId: uuid('device_id')
      .notNull()
      .references(() => devices.id),
    /** What asked for it; any pass counts for all of them. */
    reason: text('reason', { enum: SELFIE_REASONS }).notNull(),
    provider: text('provider').notNull(),
    /** Ours, sel-…, which the provider's job carries back. */
    reference: text('reference').notNull(),
    /** The provider's job that decided it; each counts once. */
    jobId: text('job_id'),
    /** unclear: the provider couldn't tell (a poor photo), so it is taken again without counting as a failure. */
    status: text('status', { enum: ['pending', 'passed', 'failed', 'unclear'] })
      .notNull()
      .default('pending'),
    note: text('note'),
    createdAt: createdAt(),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('agent_selfie_checks_reference_uq').on(t.reference),
    uniqueIndex('agent_selfie_checks_job_uq').on(t.provider, t.jobId),
    index('agent_selfie_checks_user_idx').on(t.userId, t.decidedAt),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => devices.id),
    app: text('app', { enum: APPS }).notNull(),
    /** Moves forward with each refresh, but never past absoluteExpiresAt. */
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    /** However often it is refreshed, a session ends here (SESSION_MAX_DAYS after sign-in). */
    absoluteExpiresAt: timestamp('absolute_expires_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedReason: text('revoked_reason'),
    createdAt: createdAt(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

/** Refresh tokens rotate on every use. Presenting a used one again revokes the whole session. */
export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => sessions.id),
    tokenHash: text('token_hash').notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('refresh_tokens_hash_uq').on(t.tokenHash), index('refresh_tokens_session_idx').on(t.sessionId)],
);

export const otpChallenges = pgTable(
  'otp_challenges',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    phone: text('phone').notNull(),
    codeHash: text('code_hash').notNull(),
    countryCode: char('country_code', { length: 2 }),
    requestedIp: text('requested_ip'),
    /** The app's own key for the phone that asked, when it sent one: codes are limited per device too. */
    deviceKey: text('device_key'),
    /** Given to the app to show instead of texted, under Test sign-in codes (Settings, Security). */
    shownInApp: boolean('shown_in_app').notNull().default(false),
    attempts: smallint('attempts').notNull().default(0),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index('otp_phone_created_idx').on(t.phone, t.createdAt),
    index('otp_ip_created_idx').on(t.requestedIp, t.createdAt),
    index('otp_device_created_idx').on(t.deviceKey, t.createdAt),
    index('otp_country_created_idx').on(t.countryCode, t.createdAt),
  ],
);

/** Agent-only details. A row is created the first time an agent's profile is read or changed. */
export const AGENT_PROFILE_DEFAULTS = {
  tier: 'bronze',
  categoryKeys: null,
  takesPurchases: true,
  workRadiusKm: null,
} as const;
const tierCheck = (column: unknown) => sql`${column} in (${sql.raw(AGENT_TIERS.map((t) => `'${t}'`).join(', '))})`;

export const agentProfiles = pgTable(
  'agent_profiles',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id),
    /** Set by admin. It decides the agent's commission and when their earnings can be withdrawn. */
    tier: text('tier', { enum: AGENT_TIERS }).notNull().default(AGENT_PROFILE_DEFAULTS.tier),
    tierSetBy: uuid('tier_set_by'),
    tierSetAt: timestamp('tier_set_at', { withTimezone: true }),
    /** The categories the agent receives; null means every category. */
    categoryKeys: text('category_keys').array(),
    /** Whether the agent takes errands where they buy the items. */
    takesPurchases: boolean('takes_purchases').notNull().default(AGENT_PROFILE_DEFAULTS.takesPurchases),
    /** How far the agent will travel to a pickup, in km; null for as far as matching allows (docs/matching.md). */
    workRadiusKm: smallint('work_radius_km'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('agent_profiles_tier_ck', tierCheck(t.tier)),
    check('agent_profiles_work_radius_ck', sql`${t.workRadiusKm} between 1 and 50`),
  ],
);

/**
 * "Don't match me again" (docs/matching.md, M1): someone chose, on an errand they shared, never to be matched
 * with the other person. Matching keeps the two apart either way; the other person isn't told.
 */
export const matchBlocks = pgTable(
  'match_blocks',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    otherUserId: uuid('other_user_id')
      .notNull()
      .references(() => users.id),
    /** The errand they chose it on. */
    errandId: uuid('errand_id')
      .notNull()
      .references(() => errands.id),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.otherUserId] }),
    index('match_blocks_other_idx').on(t.otherUserId),
    check('match_blocks_not_self_ck', sql`${t.userId} <> ${t.otherUserId}`),
  ],
);

/**
 * Where an agent is and whether they take errands now. The agent app reports it while online or on an
 * errand; it is cleared when they go offline with nothing running, so a location is never kept longer.
 */
export const agentPresence = pgTable(
  'agent_presence',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id),
    countryCode: text('country_code').notNull(),
    online: boolean('online').notNull().default(false),
    lat: doublePrecision('lat'),
    lng: doublePrecision('lng'),
    /** How far off the phone said the last fix might be, in metres, and when it took it (G1). */
    accuracy: doublePrecision('accuracy'),
    fixedAt: timestamp('fixed_at', { withTimezone: true }),
    location: geographyPoint('location'),
    locatedAt: timestamp('located_at', { withTimezone: true }),
    /** The phone said the position was mocked (MB4): it can't place the agent at a drop-off. */
    mocked: boolean('mocked').notNull().default(false),
    /** When they last went online; null while offline. How long they've waited counts from it (matching, M4). */
    onlineSince: timestamp('online_since', { withTimezone: true }),
    updatedAt: updatedAt(),
  },
  (t) => [index('agent_presence_location_gix').using('gist', t.location)],
);

/* ---------- Errands ---------- */

export const errands = pgTable(
  'errands',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    countryCode: char('country_code', { length: 2 })
      .notNull()
      .references(() => countries.code),
    stateCode: text('state_code').notNull(),
    /** The area the pickup is in, worked out by the server when the errand was sent. Null for older errands. */
    areaId: uuid('area_id').references(() => areas.id),
    /**
     * The prices it was sent with, from its area, city and state, else the country (Settings, Places): kept, so a
     * later price change never changes it. Null for errands from before area prices, which use the country's.
     */
    prices: jsonb('prices').$type<Prices>(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => users.id),
    agentId: uuid('agent_id').references(() => users.id),
    categoryKey: text('category_key').notNull(),
    buy: boolean('buy').notNull(),
    urgent: boolean('urgent').notNull().default(false),
    description: text('description').notNull(),
    status: text('status').$type<ErrandState>().notNull(),
    feeKobo: kobo('fee_kobo').notNull(),
    /** The customer's service fee on the current fee. Locked in the fee escrow with it. */
    serviceFeeKobo: kobo('service_fee_kobo').notNull().default(0),
    pendingOfferKobo: kobo('pending_offer_kobo'),
    itemAmountKobo: kobo('item_amount_kobo'),
    scheduledFor: timestamp('scheduled_for', { withTimezone: true }),
    settingsVersion: integer('settings_version').notNull(),
    /** The agent's tier when they accepted. Commission and the earnings hold follow it, whatever admin changes later. */
    agentTier: text('agent_tier', { enum: AGENT_TIERS }),
    /** The hand-off PIN, encrypted under a key for this errand alone ("v2:"), so the customer can see it again. Cleared when the errand ends. */
    pinCipher: text('pin_cipher'),
    /** A keyed hash of the PIN, for checking what the agent enters without decrypting it. */
    pinHmac: text('pin_hmac'),
    pinAttempts: smallint('pin_attempts').notNull().default(0),
    version: integer('version').notNull().default(0),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    /**
     * While a drop-off photo waits for the customer: when it is approved automatically (X1), and, while support
     * has that paused, since when (X2). Both cleared once the errand moves on.
     */
    releaseDueAt: timestamp('release_due_at', { withTimezone: true }),
    releasePausedAt: timestamp('release_paused_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('errands_customer_idx').on(t.customerId, t.createdAt),
    index('errands_agent_idx').on(t.agentId, t.createdAt),
    index('errands_status_idx').on(t.status),
    index('errands_country_created_idx').on(t.countryCode, t.createdAt, t.id),
    check('errands_agent_tier_ck', sql`${t.agentTier} is null or ${tierCheck(t.agentTier)}`),
  ],
);

export const errandStops = pgTable(
  'errand_stops',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    errandId: uuid('errand_id')
      .notNull()
      .references(() => errands.id),
    seq: smallint('seq').notNull(),
    kind: text('kind', { enum: ['pickup', 'stop', 'dropoff'] }).notNull(),
    label: text('label'),
    address: text('address').notNull(),
    lat: doublePrecision('lat').notNull(),
    lng: doublePrecision('lng').notNull(),
    location: geographyPoint('location').notNull(),
  },
  (t) => [
    uniqueIndex('errand_stops_seq_uq').on(t.errandId, t.seq),
    index('errand_stops_location_gix').using('gist', t.location),
  ],
);

/** Every change to an errand, in order. It feeds the tracker timeline, notifications and dispute evidence. */
export const errandEvents = pgTable(
  'errand_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    errandId: uuid('errand_id')
      .notNull()
      .references(() => errands.id),
    event: text('event').notNull(),
    fromStatus: text('from_status').$type<ErrandState | null>(),
    toStatus: text('to_status').$type<ErrandState>().notNull(),
    actorRole: text('actor_role', { enum: ['customer', 'agent', 'system', 'admin'] }).notNull(),
    actorId: uuid('actor_id'),
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [
    index('errand_events_errand_idx').on(t.errandId, t.id),
    // Each agent's accepts and withdrawals, for ranking (docs/matching.md, M4).
    index('errand_events_actor_idx').on(t.actorId, t.event, t.id),
  ],
);

/* ---------- Chat ---------- */

/** One conversation per agent assignment, so a new agent never sees what the customer said to the last one. */
export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    errandId: uuid('errand_id')
      .notNull()
      .references(() => errands.id),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => users.id),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => users.id),
    /** Set when the agent leaves or the errand ends; the conversation is read-only from then on. */
    closedAt: timestamp('closed_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('conversations_errand_agent_uq').on(t.errandId, t.agentId)],
);

export const messages = pgTable(
  'messages',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id),
    senderId: uuid('sender_id').references(() => users.id),
    senderRole: text('sender_role', { enum: ['customer', 'agent', 'system'] }).notNull(),
    clientId: text('client_id'),
    kind: text('kind', { enum: ['text', 'system', 'photo'] }).notNull(),
    body: text('body').notNull(),
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [
    index('messages_conversation_idx').on(t.conversationId, t.id),
    uniqueIndex('messages_client_id_uq').on(t.conversationId, t.senderId, t.clientId),
  ],
);

/**
 * Masked calls between an errand's customer and agent: who called whom and when, for support. Nothing of
 * the call itself is kept; calls aren't recorded.
 */
export const errandCalls = pgTable(
  'errand_calls',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    errandId: uuid('errand_id')
      .notNull()
      .references(() => errands.id),
    callerId: uuid('caller_id')
      .notNull()
      .references(() => users.id),
    calleeId: uuid('callee_id')
      .notNull()
      .references(() => users.id),
    callerRole: text('caller_role', { enum: ['customer', 'agent'] }).notNull(),
    provider: text('provider').notNull(),
    providerRef: text('provider_ref'),
    createdAt: createdAt(),
  },
  (t) => [
    index('errand_calls_errand_idx').on(t.errandId, t.createdAt),
    // A provider asking about a call it placed names it by its own reference.
    index('errand_calls_provider_ref_idx').on(t.provider, t.providerRef),
  ],
);

/* ---------- Money ---------- */

/**
 * Ledger account types. Wallets, earnings, escrows and revenue are owed by the platform (credit-normal);
 * cash at the payment provider and its fees are what the platform holds or spends (debit-normal).
 */
export const LEDGER_ACCOUNT_TYPES = [
  'customer_wallet',
  'agent_available',
  'agent_held',
  'fee_escrow',
  'item_escrow',
  'payouts_in_transit',
  'platform_revenue',
  'provider_cash',
  'provider_fees',
] as const;
export type LedgerAccountType = (typeof LEDGER_ACCOUNT_TYPES)[number];

export const ledgerAccounts = pgTable(
  'ledger_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** For example customer_wallet:<user id> or platform_revenue:NG. */
    key: text('key').notNull(),
    type: text('type', { enum: LEDGER_ACCOUNT_TYPES }).notNull(),
    countryCode: char('country_code', { length: 2 })
      .notNull()
      .references(() => countries.code),
    currency: char('currency', { length: 3 }).notNull(),
    /** The user or errand the account belongs to; null for platform accounts. */
    ownerId: uuid('owner_id'),
    normal: text('normal', { enum: ['debit', 'credit'] }).notNull(),
    /**
     * For people's and errands' accounts: kept in step with the postings in the same transaction, in the
     * account's normal direction. Platform accounts stay at 0 here; their balance is summed from postings.
     */
    balance: kobo('balance').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('ledger_accounts_key_uq').on(t.key),
    index('ledger_accounts_owner_idx').on(t.ownerId),
    // A person's or errand's account can never go below zero, whatever its flags say. Platform accounts keep
    // their balance in their postings, not in this column.
    check('ledger_accounts_balance_ck', sql`${t.ownerId} is null or ${t.balance} >= 0`),
  ],
);

/** One money movement. Its postings always sum to zero; the key makes every movement happen once. */
export const journalEntries = pgTable(
  'journal_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    key: text('key').notNull(),
    kind: text('kind').notNull(),
    countryCode: char('country_code', { length: 2 })
      .notNull()
      .references(() => countries.code),
    errandId: uuid('errand_id').references(() => errands.id),
    memo: text('memo').notNull().default(''),
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('journal_entries_key_uq').on(t.key), index('journal_entries_errand_idx').on(t.errandId)],
);

/** Positive amounts are debits, negative amounts credits. */
export const postings = pgTable(
  'postings',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    journalId: uuid('journal_id')
      .notNull()
      .references(() => journalEntries.id),
    accountId: uuid('account_id')
      .notNull()
      .references(() => ledgerAccounts.id),
    amount: kobo('amount').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('postings_account_idx').on(t.accountId, t.id),
    index('postings_journal_idx').on(t.journalId),
    check('postings_amount_ck', sql`${t.amount} <> 0`),
  ],
);

/** A bank-transfer top-up through a one-time account number from the payment provider. */
export const deposits = pgTable(
  'deposits',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    countryCode: char('country_code', { length: 2 })
      .notNull()
      .references(() => countries.code),
    provider: text('provider').notNull(),
    reference: text('reference').notNull(),
    status: text('status', { enum: ['pending', 'succeeded', 'failed'] })
      .notNull()
      .default('pending'),
    /**
     * one_time: to an account number issued for this top-up, for its amount. fixed: a transfer into the
     * customer's own fixed account, recorded when it arrives.
     */
    method: text('method', { enum: ['one_time', 'fixed'] })
      .notNull()
      .default('one_time'),
    fixedAccountId: uuid('fixed_account_id').references(() => fixedAccounts.id),
    amountKobo: kobo('amount_kobo').notNull(),
    accountNumber: text('account_number').notNull(),
    accountName: text('account_name').notNull(),
    bankName: text('bank_name').notNull(),
    /** When a one-time account number stops taking money; none for a fixed account. */
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    /** What the provider says arrived, which is what the wallet is credited with. */
    paidKobo: kobo('paid_kobo'),
    feesKobo: kobo('fees_kobo'),
    senderName: text('sender_name'),
    senderBank: text('sender_bank'),
    /** The sender's name does not match the customer's: shown to admin as a fraud signal. */
    senderMismatch: boolean('sender_mismatch').notNull().default(false),
    /** The app's key for the request, so a repeated tap makes one top-up. */
    requestKey: text('request_key'),
    createdAt: createdAt(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('deposits_request_key_uq').on(t.userId, t.requestKey),
    uniqueIndex('deposits_reference_uq').on(t.reference),
    index('deposits_user_idx').on(t.userId, t.createdAt),
    // The admin list: a country's top-ups, newest first.
    index('deposits_country_created_idx').on(t.countryCode, t.createdAt, t.id),
  ],
);

/**
 * A customer's own fixed account number at a payments provider: any transfer to it lands in their wallet.
 * One per provider; the customer's BVN and bank account, which providers ask for to issue one, are passed
 * on and never kept.
 */
export const fixedAccounts = pgTable(
  'fixed_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    countryCode: char('country_code', { length: 2 })
      .notNull()
      .references(() => countries.code),
    provider: text('provider').notNull(),
    /** Our reference for this attempt at the provider: jva-<user id>-<attempt> (see fixedOwnerRef). */
    ownerRef: text('owner_ref').notNull(),
    /** The provider's own reference for the account (Paystack's customer code, Flutterwave's order_ref). */
    providerRef: text('provider_ref'),
    /** pending: the provider is still issuing it (identifying the customer). failed: it couldn't; they can try again. */
    status: text('status', { enum: ['pending', 'active', 'failed'] }).notNull(),
    accountNumber: text('account_number'),
    accountName: text('account_name'),
    bankName: text('bank_name'),
    failureReason: text('failure_reason'),
    /** Failed tries in a row, and when the last one was: a few a day are allowed, so BVNs can't be tested. */
    failures: integer('failures').notNull().default(0),
    lastFailureAt: timestamp('last_failure_at', { withTimezone: true }),
    /** When this attempt was asked for: one the provider still hasn't settled after a week can be asked again. */
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    /** Set while one request asks the provider about it, so two never do at once. */
    checkingUntil: timestamp('checking_until', { withTimezone: true }),
    /** What the provider charged for issuing it, booked as a cost when it became active. */
    issueFeeKobo: kobo('issue_fee_kobo').notNull().default(0),
    activatedAt: timestamp('activated_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('fixed_accounts_user_provider_uq').on(t.userId, t.provider),
    index('fixed_accounts_provider_ref_idx').on(t.provider, t.providerRef),
    index('fixed_accounts_country_activated_idx').on(t.countryCode, t.activatedAt),
  ],
);

/** The agent's own-name bank account. A new one replaces the old; the old row is kept for history. */
export const payoutAccounts = pgTable(
  'payout_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    provider: text('provider').notNull(),
    bankCode: text('bank_code').notNull(),
    bankName: text('bank_name').notNull(),
    /** Encrypted at rest (fields.ts), as is the name on the account. */
    accountNumber: encrypted('payout_accounts', 'account_number').notNull(),
    accountName: encrypted('payout_accounts', 'account_name').notNull(),
    /** The account number's last four digits, readable, for lists and support. */
    accountLast4: text('account_last4'),
    /** Some providers' recipient codes carry the account number (Flutterwave's), so it is encrypted too. */
    recipientCode: encrypted('payout_accounts', 'recipient_code').notNull(),
    /**
     * A keyed hash of the bank and account number, so one account saved by two agents is flagged (I3) without
     * decrypting every account to compare them.
     */
    accountFingerprint: text('account_fingerprint'),
    /**
     * approved: withdrawals go here. pending: the bank's name for it only nearly matches the legal name, so
     * support looks first, and withdrawals keep going to the approved one meanwhile. declined: support said no.
     */
    reviewStatus: text('review_status', { enum: ['approved', 'pending', 'declined'] })
      .notNull()
      .default('approved'),
    reviewedBy: uuid('reviewed_by').references(() => admins.id),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reviewNote: text('review_note'),
    createdAt: createdAt(),
    replacedAt: timestamp('replaced_at', { withTimezone: true }),
  },
  (t) => [
    index('payout_accounts_user_idx').on(t.userId),
    // One account in use, and at most one waiting for support, per agent.
    uniqueIndex('payout_accounts_current_uq')
      .on(t.userId)
      .where(sql`${t.replacedAt} is null and ${t.reviewStatus} = 'approved'`),
    uniqueIndex('payout_accounts_pending_uq')
      .on(t.userId)
      .where(sql`${t.replacedAt} is null and ${t.reviewStatus} = 'pending'`),
    index('payout_accounts_review_idx').on(t.reviewStatus, t.createdAt),
    index('payout_accounts_fingerprint_idx').on(t.accountFingerprint),
  ],
);

/** An agent's withdrawal to their payout account. The amount leaves their balance when requested. */
export const payouts = pgTable(
  'payouts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    countryCode: char('country_code', { length: 2 })
      .notNull()
      .references(() => countries.code),
    payoutAccountId: uuid('payout_account_id')
      .notNull()
      .references(() => payoutAccounts.id),
    reference: text('reference').notNull(),
    speed: text('speed', { enum: ['instant', 'scheduled'] }).notNull(),
    status: text('status', { enum: ['requested', 'processing', 'succeeded', 'failed'] })
      .notNull()
      .default('requested'),
    /** Taken from the balance. */
    amountKobo: kobo('amount_kobo').notNull(),
    feeKobo: kobo('fee_kobo').notNull().default(0),
    /** Sent to the bank: the amount less the fee. */
    sendKobo: kobo('send_kobo').notNull(),
    /** The payments provider the transfer went through, set when it is sent. */
    provider: text('provider'),
    providerTransferCode: text('provider_transfer_code'),
    failureReason: text('failure_reason'),
    /** The app's key for the request, so a repeated tap or retry makes one withdrawal. */
    requestKey: text('request_key'),
    /** Times it was handed to the provider. Only a first try that is refused outright is given back. */
    attempts: integer('attempts').notNull().default(0),
    /** Set while one run is sending it, so two never send it at once. */
    sendingUntil: timestamp('sending_until', { withTimezone: true }),
    createdAt: createdAt(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('payouts_reference_uq').on(t.reference),
    uniqueIndex('payouts_request_key_uq').on(t.userId, t.requestKey),
    index('payouts_user_idx').on(t.userId, t.createdAt),
    index('payouts_status_idx').on(t.status),
    index('payouts_country_created_idx').on(t.countryCode, t.createdAt, t.id),
  ],
);

/** Errand earnings that become withdrawable later (Bronze and new agents). */
export const earningHolds = pgTable(
  'earning_holds',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    countryCode: char('country_code', { length: 2 })
      .notNull()
      .references(() => countries.code),
    errandId: uuid('errand_id').references(() => errands.id),
    amountKobo: kobo('amount_kobo').notNull(),
    availableAt: timestamp('available_at', { withTimezone: true }).notNull(),
    releasedAt: timestamp('released_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('earning_holds_due_idx').on(t.userId, t.availableAt)],
);

/** Every webhook from a payment provider, kept as received. A repeat delivery is recognised and skipped. */
export const providerEvents = pgTable(
  'provider_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    provider: text('provider').notNull(),
    eventKey: text('event_key').notNull(),
    kind: text('kind').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    error: text('error'),
  },
  (t) => [uniqueIndex('provider_events_key_uq').on(t.provider, t.eventKey)],
);

/**
 * Identity checks started, for the daily limit (docs/security-plan.md, I1): each may cost a paid check with
 * the provider. Page opens (and their binding) are from the pages Jiffo once served for a provider: nothing
 * writes them now, and the daily prune clears the old rows.
 */
export const identityAttempts = pgTable(
  'identity_attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: text('kind', { enum: ['start', 'page_open'] }).notNull(),
    userId: uuid('user_id').references(() => users.id),
    reference: text('reference'),
    /** No longer written. For a page open: a hash of the cookie its browser was given. */
    binding: text('binding'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('identity_attempts_user_ix').on(t.userId, t.createdAt),
    index('identity_attempts_reference_ix').on(t.reference, t.createdAt),
  ],
);

/**
 * Webhook signatures already seen, with a hash of the body each came with, for providers whose signature
 * doesn't cover the body (Smile ID): the same signature never vouches for a different body.
 */
export const webhookSignatures = pgTable(
  'webhook_signatures',
  {
    provider: text('provider').notNull(),
    signature: text('signature').notNull(),
    bodyHash: text('body_hash').notNull(),
    seenAt: timestamp('seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.provider, t.signature] })],
);

/** The daily check of the ledger's cash against the balance the payment provider reports. */
export const reconciliationRuns = pgTable('reconciliation_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  countryCode: char('country_code', { length: 2 })
    .notNull()
    .references(() => countries.code),
  provider: text('provider').notNull(),
  providerBalanceKobo: kobo('provider_balance_kobo').notNull(),
  ledgerCashKobo: kobo('ledger_cash_kobo').notNull(),
  /** Money on its way out that the provider has already taken from its balance. */
  inTransitKobo: kobo('in_transit_kobo').notNull(),
  differenceKobo: kobo('difference_kobo').notNull(),
  pendingDeposits: integer('pending_deposits').notNull(),
  stuckPayouts: integer('stuck_payouts').notNull(),
  /**
   * The difference finance last accepted (at the latest cleared check), so a gap that was explained once
   * isn't counted again: only the change since then is.
   */
  baselineKobo: kobo('baseline_kobo').notNull().default(0),
  /** A shortfall since the baseline beyond the tolerance: instant withdrawals stop until finance clears it. */
  pausesInstant: boolean('pauses_instant').notNull().default(false),
  clearedAt: timestamp('cleared_at', { withTimezone: true }),
  clearedBy: uuid('cleared_by').references(() => admins.id),
  clearNote: text('clear_note'),
  createdAt: createdAt(),
});

/**
 * Things finance or the team must look at: a nightly-check gap, a low provider balance, a withdrawal the
 * approval URL refused, an unclear transfer. One stays open per kind, country and key until someone resolves it.
 */
export const alerts = pgTable(
  'alerts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    countryCode: char('country_code', { length: 2 }).references(() => countries.code),
    kind: text('kind').notNull(),
    /** Tells apart open alerts of one kind, e.g. the payout an unclear transfer is about. */
    dedupeKey: text('dedupe_key').notNull().default(''),
    message: text('message').notNull(),
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedBy: uuid('resolved_by').references(() => admins.id),
    resolveNote: text('resolve_note'),
  },
  (t) => [
    uniqueIndex('alerts_open_uq')
      .on(t.kind, t.countryCode, t.dedupeKey)
      .where(sql`resolved_at is null`),
    index('alerts_country_created_idx').on(t.countryCode, t.createdAt),
  ],
);

/* ---------- Fraud flags ---------- */

/**
 * Something that looks like fraud, for a person to look at (docs/security-plan.md, E5, E6, I3): an errand to
 * carry cash, a customer and agent sharing a phone, two agents on one bank account. A flag refuses nothing by
 * itself. Errands flagged and not cleared are left out of the counts admin sets tiers by (F3).
 */
export const riskFlags = pgTable(
  'risk_flags',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    countryCode: char('country_code', { length: 2 })
      .notNull()
      .references(() => countries.code),
    /** risk: the Risk queue, for operations. verification: accounts, for the verification team. */
    queue: text('queue', { enum: RISK_QUEUES }).notNull(),
    kind: text('kind', { enum: RISK_FLAG_KINDS }).notNull(),
    /**
     * What a flag is about, so the same finding isn't flagged twice: the errand, or the two accounts. A pair
     * flagged again and again counts its rounds in it.
     */
    dedupeKey: text('dedupe_key').notNull(),
    /** The account it is about: the customer, for an errand. */
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    /** The other account: the errand's agent, or the account sharing the phone or bank account. */
    otherUserId: uuid('other_user_id').references(() => users.id),
    /** What was found, for the reviewer: the words, how a phone was shared, the minutes and amounts. */
    details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
    status: text('status', { enum: RISK_FLAG_STATUSES }).notNull().default('open'),
    decidedBy: uuid('decided_by').references(() => admins.id),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionNote: text('decision_note'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('risk_flags_dedupe_uq').on(t.kind, t.dedupeKey),
    index('risk_flags_queue_idx').on(t.countryCode, t.queue, t.status, t.createdAt, t.id),
    index('risk_flags_user_idx').on(t.userId),
    index('risk_flags_other_user_idx').on(t.otherUserId),
  ],
);

/** The errands a flag is about: one, or every errand of a pair flagged together. */
export const riskFlagErrands = pgTable(
  'risk_flag_errands',
  {
    flagId: uuid('flag_id')
      .notNull()
      .references(() => riskFlags.id),
    errandId: uuid('errand_id')
      .notNull()
      .references(() => errands.id),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.flagId, t.errandId] }), index('risk_flag_errands_errand_idx').on(t.errandId)],
);

/**
 * The Wi-Fi networks and addresses an account's phones used (docs/security-plan.md, E6), as keyed hashes of
 * the public address: never the address. Wi-Fi and wired connections, by the app's word, and phone networks
 * only to mark an address as a carrier's, which thousands share. Forgotten 90 days after last use.
 */
export const userNetworks = pgTable(
  'user_networks',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    kind: text('kind', { enum: ['wifi', 'wired', 'cellular'] }).notNull(),
    fingerprint: text('fingerprint').notNull(),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.kind, t.fingerprint] }),
    index('user_networks_fingerprint_idx').on(t.fingerprint, t.lastSeenAt),
    index('user_networks_last_seen_idx').on(t.lastSeenAt),
  ],
);

/**
 * Where the agent was while out on an errand (docs/security-plan.md, G1, G4, E6), from their phone's
 * reports: for the fake-GPS checks and a dispute's evidence. Deleted after the days in Settings, Security
 * (90 unless changed), unless the errand is in dispute or a flag on it is still open.
 */
export const errandTrail = pgTable(
  'errand_trail',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    errandId: uuid('errand_id')
      .notNull()
      .references(() => errands.id),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => users.id),
    lat: doublePrecision('lat').notNull(),
    lng: doublePrecision('lng').notNull(),
    /** The phone said the position was mocked (MB4): kept, but never counted as where the agent was. */
    mocked: boolean('mocked').notNull().default(false),
    /** How far off the phone said the fix might be, in metres. */
    accuracy: doublePrecision('accuracy'),
    /** When the phone took the fix, by its clock, when it said and it was plausible. */
    fixedAt: timestamp('fixed_at', { withTimezone: true }),
    /** When it reached us. */
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('errand_trail_errand_idx').on(t.errandId, t.at), index('errand_trail_at_idx').on(t.at)],
);

/**
 * A dispute's evidence pack (docs/security-plan.md, E8): a fixed copy of what the errand held when it went
 * into dispute, or when staff took another: its events (offers, item amounts and PIN entries among them),
 * chat, uploads, calls, flags and money, and a fingerprint of its GPS trail, which G4 keeps only so long.
 * Append-only, enforced by the database, with a SHA-256 of the pack as made.
 */
export const disputeEvidence = pgTable(
  'dispute_evidence',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    errandId: uuid('errand_id')
      .notNull()
      .references(() => errands.id),
    /** What made it: the event that put the errand into dispute, or staff taking another. */
    reason: text('reason', {
      enum: ['open_dispute', 'pin_locked', 'item_lock_timeout', 'unreachable_timeout', 'admin_intervene', 'staff'],
    }).notNull(),
    takenBy: uuid('taken_by').references(() => admins.id),
    content: jsonb('content').$type<Record<string, unknown>>().notNull(),
    /** SHA-256 of the content as canonical JSON (keys in order): anyone can work it out again. */
    sha256: text('sha256').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('dispute_evidence_errand_idx').on(t.errandId, t.createdAt)],
);

/**
 * An emergency pressed in an app (docs/security-plan.md, E9): who, from which app, on which errand, and
 * where the phone was, with the positions it sent after, for the Safety queue. The app dials the emergency
 * number itself; this is Jiffo's record, for the safety team to follow up.
 */
export const safetyEvents = pgTable(
  'safety_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    countryCode: char('country_code', { length: 2 })
      .notNull()
      .references(() => countries.code),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    app: text('app', { enum: APPS }).notNull(),
    errandId: uuid('errand_id').references(() => errands.id),
    lat: doublePrecision('lat'),
    lng: doublePrecision('lng'),
    accuracy: doublePrecision('accuracy'),
    /** Where the phone was after, as the app keeps sending it for a while: the latest few hundred. */
    positions: jsonb('positions')
      .$type<Array<{ lat: number; lng: number; accuracy: number | null; at: string }>>()
      .notNull()
      .default([]),
    status: text('status', { enum: ['open', 'handled'] })
      .notNull()
      .default('open'),
    /** The latest press: presses within half an hour of it are this emergency, and it is followed that long. */
    lastPressedAt: timestamp('last_pressed_at', { withTimezone: true }).notNull().defaultNow(),
    handledBy: uuid('handled_by').references(() => admins.id),
    handledAt: timestamp('handled_at', { withTimezone: true }),
    note: text('note'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('safety_events_queue_idx').on(t.countryCode, t.status, t.createdAt),
    index('safety_events_user_idx').on(t.userId, t.createdAt),
  ],
);

/**
 * Which account each identity check was for, by our reference (docs/security-plan.md, I3): a provider that
 * finds the same face on an earlier check names that check by its reference, which may be long replaced on
 * the account. Kept for a little over a year, as providers look back that far at most.
 */
export const identityReferences = pgTable(
  'identity_references',
  {
    reference: text('reference').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    provider: text('provider').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('identity_references_created_idx').on(t.createdAt)],
);

/* ---------- Files ---------- */

export const UPLOAD_PURPOSES = ['receipt', 'item_photo', 'dropoff_photo', 'chat_photo'] as const;
export type UploadPurpose = (typeof UPLOAD_PURPOSES)[number];

/**
 * A file someone was allowed to upload for an errand. An errand event or chat message may only point
 * at uploads its sender made for that errand, so nobody can attach someone else's photo.
 */
export const uploads = pgTable(
  'uploads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    key: text('key').notNull(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id),
    errandId: uuid('errand_id')
      .notNull()
      .references(() => errands.id),
    purpose: text('purpose', { enum: UPLOAD_PURPOSES }).notNull(),
    /** As uploaded, then image/jpeg once the server has made its own copy. */
    contentType: text('content_type').notNull(),
    /**
     * When the server opened the photo and kept its own copy, re-encoded (docs/security-plan.md, C1). Until
     * then nobody is shown it, and it can't be sent with anything.
     */
    checkedAt: timestamp('checked_at', { withTimezone: true }),
    /** The kept copy's SHA-256 and size, so a dispute's evidence can show the photo is the one sent (E8). */
    sha256: text('sha256'),
    size: integer('size'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('uploads_key_uq').on(t.key), index('uploads_errand_idx').on(t.errandId)],
);

/* ---------- Ratings ---------- */

/** One rating each way per errand, given after it completes. */
export const errandRatings = pgTable(
  'errand_ratings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    errandId: uuid('errand_id')
      .notNull()
      .references(() => errands.id),
    raterRole: text('rater_role', { enum: ['customer', 'agent'] }).notNull(),
    raterId: uuid('rater_id')
      .notNull()
      .references(() => users.id),
    rateeId: uuid('ratee_id')
      .notNull()
      .references(() => users.id),
    stars: smallint('stars').notNull(),
    comment: text('comment'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('errand_ratings_errand_role_uq').on(t.errandId, t.raterRole),
    index('errand_ratings_ratee_idx').on(t.rateeId),
    check('errand_ratings_stars_ck', sql`${t.stars} between 1 and 5`),
  ],
);

/* ---------- Agent applications ---------- */

/**
 * An agent's application to work on Jiffo. Agents see the board only once it is approved. Identity documents
 * stay with the identity provider: this keeps the results, the legal name and date of birth from the NIN
 * record, and a one-way fingerprint of the NIN so one person can't open two agent accounts.
 */
export const agentApplications = pgTable(
  'agent_applications',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id),
    countryCode: char('country_code', { length: 2 })
      .notNull()
      .references(() => countries.code),
    status: text('status', { enum: ['draft', 'checking', 'approved', 'review', 'rejected'] })
      .notNull()
      .default('draft'),
    stateCode: text('state_code'),
    area: text('area'),
    /**
     * HMAC of the ID's type and number: equal IDs give equal fingerprints, and the number can't be read back.
     * It is claimed here only once the provider has confirmed the ID and that the selfie matches its owner;
     * until then it waits in pendingIdFingerprint, so typing someone else's ID reserves nothing. (The columns
     * are named for the NIN, the only ID they held at first.)
     */
    idFingerprint: text('nin_fingerprint'),
    pendingIdFingerprint: text('pending_nin_fingerprint'),
    /** The identity provider the check was started with; it finishes there even if admin switches. */
    identityProvider: text('identity_provider'),
    /** The ID the agent verifies with, and whether their BVN is checked as well. */
    identityIdType: text('identity_id_type'),
    identityWithBvn: boolean('identity_with_bvn').notNull().default(false),
    identityReference: text('identity_reference'),
    /** No longer written. The app session a check was started from, for the pages Jiffo once served. */
    identitySessionId: uuid('identity_session_id'),
    identityOutcome: text('identity_outcome', { enum: ['passed', 'failed', 'review'] }),
    identityCheckedAt: timestamp('identity_checked_at', { withTimezone: true }),
    /** The name and date of birth on the ID record, encrypted at rest (fields.ts). */
    legalName: encrypted('agent_applications', 'legal_name'),
    /** Keyed hashes of the legal name's words, so support can search by name (fields.ts). */
    legalNameIndex: text('legal_name_index').array(),
    dateOfBirth: encrypted('agent_applications', 'date_of_birth'),
    /** Only our safety team sees it. */
    /** Home address and emergency contact, encrypted at rest (fields.ts). */
    address: encrypted('agent_applications', 'address'),
    emergencyName: encrypted('agent_applications', 'emergency_name'),
    emergencyPhone: encrypted('agent_applications', 'emergency_phone'),
    emergencyRelationship: encrypted('agent_applications', 'emergency_relationship'),
    addressProvider: text('address_provider'),
    addressReference: text('address_reference'),
    addressOutcome: text('address_outcome', { enum: ['passed', 'failed', 'review'] }),
    termsAcceptedAt: timestamp('terms_accepted_at', { withTimezone: true }),
    /** Each check's result, in words, for the agent and for support. Never the documents. */
    checks: jsonb('checks').$type<Array<{ key: string; outcome: string; note?: string }>>().notNull().default([]),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decidedBy: uuid('decided_by'),
    decisionNote: text('decision_note'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('agent_applications_nin_uq')
      .on(t.idFingerprint)
      .where(sql`${t.idFingerprint} is not null`),
    index('agent_applications_status_idx').on(t.countryCode, t.status),
    index('agent_applications_legal_name_ix').using('gin', t.legalNameIndex),
  ],
);

/**
 * A customer's identity check, with the provider switched on in the panel. Customers add money and request
 * errands once verified. Like an agent's, it keeps only the result, the legal name, the date of birth and a
 * fingerprint of the ID; never the ID number, the document or the selfie.
 */
export const customerVerifications = pgTable(
  'customer_verifications',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id),
    /**
     * checking: started, the result not back. verified: the customer can use everything. review: support
     * decides. failed: the check didn't pass; the customer can try again. declined: support said no.
     */
    status: text('status', { enum: ['checking', 'verified', 'review', 'failed', 'declined'] }).notNull(),
    provider: text('provider').notNull(),
    reference: text('reference').notNull(),
    /** No longer written. The app session a check was started from, for the pages Jiffo once served. */
    sessionId: uuid('session_id'),
    idType: text('id_type').notNull(),
    /** The provider's overall answer, once back. */
    outcome: text('outcome', { enum: ['passed', 'failed', 'review'] }),
    checks: jsonb('checks').$type<Array<{ key: string; outcome: string; note?: string }>>().notNull().default([]),
    /** The name and date of birth on the ID record, encrypted at rest (fields.ts). */
    legalName: encrypted('customer_verifications', 'legal_name'),
    /** Keyed hashes of the legal name's words, so support can search by name (fields.ts). */
    legalNameIndex: text('legal_name_index').array(),
    dateOfBirth: encrypted('customer_verifications', 'date_of_birth'),
    /** As on agent applications: claimed once the ID is shown to be theirs, else waiting as pending. */
    idFingerprint: text('id_fingerprint'),
    pendingIdFingerprint: text('pending_id_fingerprint'),
    checkedAt: timestamp('checked_at', { withTimezone: true }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decidedBy: uuid('decided_by'),
    decisionNote: text('decision_note'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('customer_verifications_id_uq')
      .on(t.idFingerprint)
      .where(sql`${t.idFingerprint} is not null`),
    uniqueIndex('customer_verifications_reference_uq').on(t.provider, t.reference),
    index('customer_verifications_status_idx').on(t.status),
    index('customer_verifications_legal_name_ix').using('gin', t.legalNameIndex),
  ],
);

/* ---------- Admin ---------- */

/** What each role may do is in @jiffo/shared (ADMIN_ROLE_INFO), so the API and the panel agree. */
export { ADMIN_ROLES, type AdminRole };

/** A Jiffo staff member. They join by invite, set a password, then must set up an authenticator app. */
export const admins = pgTable(
  'admins',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Always stored in lower case. */
    email: text('email').notNull(),
    name: text('name').notNull(),
    /**
     * Their own phone number, in E.164: the customer or agent account they hold in the apps (one account per
     * number). They can't change that account, or an errand it is part of (docs/security-plan.md, D3).
     */
    phone: text('phone'),
    role: text('role', { enum: ADMIN_ROLES }).notNull(),
    status: text('status', { enum: ['invited', 'active', 'disabled'] })
      .notNull()
      .default('invited'),
    passwordHash: text('password_hash'),
    /** The authenticator secret, encrypted. Set when setup starts; only used once totpEnabledAt is set. */
    totpCipher: text('totp_cipher'),
    totpEnabledAt: timestamp('totp_enabled_at', { withTimezone: true }),
    /** The last 30-second step a code was accepted for, so the same code can't be used twice. */
    totpLastStep: integer('totp_last_step'),
    /** Only the hash of the invite link's token is kept. */
    inviteTokenHash: text('invite_token_hash'),
    inviteExpiresAt: timestamp('invite_expires_at', { withTimezone: true }),
    invitedBy: uuid('invited_by'),
    lastSignInAt: timestamp('last_sign_in_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('admins_email_uq').on(t.email), uniqueIndex('admins_invite_uq').on(t.inviteTokenHash)],
);

/** A signed-in admin. The token is opaque and only its hash is kept; sessions end when idle or at a hard limit. */
export const adminSessions = pgTable(
  'admin_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    adminId: uuid('admin_id')
      .notNull()
      .references(() => admins.id),
    tokenHash: text('token_hash').notNull(),
    ip: text('ip'),
    userAgent: text('user_agent'),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedReason: text('revoked_reason'),
    /**
     * When the admin last proved it was them: at sign-in, then each time they confirm. Money actions need it
     * recent (docs/security-plan.md, D6).
     */
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('admin_sessions_token_uq').on(t.tokenHash), index('admin_sessions_admin_idx').on(t.adminId)],
);

/**
 * An admin's passkey (WebAuthn, docs/security-plan.md, D2, X6): the public key only. Roles that move money
 * or decide ID checks sign in with one.
 */
export const adminPasskeys = pgTable(
  'admin_passkeys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    adminId: uuid('admin_id')
      .notNull()
      .references(() => admins.id),
    /** The credential's id, base64url, as the browser gives it. */
    credentialId: text('credential_id').notNull(),
    /** The COSE public key, base64url. */
    publicKey: text('public_key').notNull(),
    /** The authenticator's signature count, so a cloned key that reuses an old count is refused. */
    counter: bigint('counter', { mode: 'number' }).notNull().default(0),
    transports: jsonb('transports').$type<string[]>().notNull().default([]),
    name: text('name').notNull(),
    createdAt: createdAt(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('admin_passkeys_credential_uq').on(t.credentialId),
    index('admin_passkeys_admin_idx').on(t.adminId),
  ],
);

/** One passkey challenge, used once: to add a passkey, to sign in with one, or to confirm it's them. */
export const adminPasskeyChallenges = pgTable(
  'admin_passkey_challenges',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    adminId: uuid('admin_id')
      .notNull()
      .references(() => admins.id),
    purpose: text('purpose', { enum: ['register', 'sign_in', 'confirm'] }).notNull(),
    challenge: text('challenge').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('admin_passkey_challenges_uq').on(t.challenge),
    index('admin_passkey_challenges_admin_idx').on(t.adminId),
  ],
);

/** Every admin sign-in attempt, kept for the lockouts and as a record. Unknown emails are recorded too. */
export const adminSignInAttempts = pgTable(
  'admin_sign_in_attempts',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    email: text('email').notNull(),
    ip: text('ip'),
    stage: text('stage', { enum: ['password', 'code', 'confirm'] }).notNull(),
    succeeded: boolean('succeeded').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('admin_attempts_email_idx').on(t.email, t.createdAt),
    index('admin_attempts_ip_idx').on(t.ip, t.createdAt),
  ],
);

/**
 * What admins changed, written in the same transaction as the change itself. Append-only: the database
 * refuses to change or delete a row (migration 0025), so nobody, admins included, can rewrite it.
 */
export const adminAudit = pgTable(
  'admin_audit',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    /** The admin who made the change; empty for the server's command line, which `via` names. */
    adminId: uuid('admin_id').references(() => admins.id),
    /** Where the change came from: the panel, or the command line on a server. */
    via: text('via', { enum: ['panel', 'cli'] })
      .notNull()
      .default('panel'),
    /** For example team.invite, errand.resolve or wallet.adjust. */
    action: text('action').notNull(),
    targetType: text('target_type'),
    targetId: text('target_id'),
    countryCode: char('country_code', { length: 2 }),
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
    /** Why, as the admin gave it (docs/security-plan.md, D7). */
    reason: text('reason'),
    ip: text('ip'),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
  },
  (t) => [
    index('admin_audit_admin_created_idx').on(t.adminId, t.action, t.createdAt),
    check('admin_audit_actor', sql`${t.adminId} is not null or ${t.via} = 'cli'`),
    index('admin_audit_created_idx').on(t.createdAt),
    index('admin_audit_target_idx').on(t.targetType, t.targetId),
  ],
);

/**
 * A change waiting for a second admin (docs/security-plan.md, D3, D4, X7). It runs only when someone other
 * than the person who asked approves it, unless nobody else holds the permission (selfApproved). The
 * database refuses a decision by the requester otherwise, whatever the code does.
 */
export const adminApprovals = pgTable(
  'admin_approvals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: text('kind', { enum: APPROVAL_KINDS }).notNull(),
    /** What the approver must be allowed to do. */
    permission: text('permission').notNull(),
    countryCode: char('country_code', { length: 2 }),
    targetType: text('target_type'),
    targetId: text('target_id'),
    /** What it does, in a sentence, for the person deciding. */
    summary: text('summary').notNull(),
    /** The request as it was made. Secret values (provider keys) are sealed, never stored readable. */
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    requestedBy: uuid('requested_by')
      .notNull()
      .references(() => admins.id),
    requestedIp: text('requested_ip'),
    /** The asker's browser, for the audit entry of the change when it runs. */
    requestedUserAgent: text('requested_user_agent'),
    /** Why, from the person asking. */
    note: text('note').notNull(),
    status: text('status', { enum: APPROVAL_STATUSES }).notNull().default('pending'),
    selfApproved: boolean('self_approved').notNull().default(false),
    decidedBy: uuid('decided_by').references(() => admins.id),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionNote: text('decision_note'),
    result: jsonb('result').$type<Record<string, unknown>>(),
    error: text('error'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('admin_approvals_status_idx').on(t.status, t.createdAt),
    index('admin_approvals_requested_idx').on(t.requestedBy, t.createdAt),
    check(
      'admin_approvals_second_person',
      sql`${t.decidedBy} is null or ${t.decidedBy} <> ${t.requestedBy} or ${t.selfApproved} or ${t.status} = 'cancelled'`,
    ),
  ],
);

/* ---------- Providers ---------- */

/**
 * Admin's settings for each outside provider: its fields, with the secret ones encrypted (see SecretBox),
 * and whether it is the one in use for its category. At most one per category is active.
 */
export const providerSettings = pgTable(
  'provider_settings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    category: text('category').notNull(),
    provider: text('provider').notNull(),
    active: boolean('active').notNull().default(false),
    /** The fields that aren't secret. */
    config: jsonb('config').$type<Record<string, string>>().notNull().default({}),
    /** The secret fields as one encrypted JSON object, bound to category and provider. */
    secrets: text('secrets'),
    /**
     * The secret part of the callback address, for providers that call us without signing (Africa's Talking
     * Voice). Random, and replaced from the panel if the address leaks.
     */
    callbackToken: text('callback_token'),
    /** The last characters of each secret, to show which key is saved. */
    secretHints: jsonb('secret_hints').$type<Record<string, string>>().notNull().default({}),
    lastTestAt: timestamp('last_test_at', { withTimezone: true }),
    lastTestOk: boolean('last_test_ok'),
    lastTestMessage: text('last_test_message'),
    updatedBy: uuid('updated_by').references(() => admins.id),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('provider_settings_uq').on(t.category, t.provider),
    uniqueIndex('provider_settings_active_uq')
      .on(t.category)
      .where(sql`${t.active}`),
  ],
);

/* ---------- Cloud providers' address ranges ---------- */

/**
 * The address ranges cloud providers publish (AWS, Google Cloud, Azure, Oracle, DigitalOcean, Linode, Vultr),
 * refreshed daily (docs/security-plan.md, A10). A sign-in from one is from a server, not a phone: a risk
 * signal for more checks, never a refusal. Nothing about anyone is sent to get them.
 */
export const cloudIpRanges = pgTable(
  'cloud_ip_ranges',
  {
    provider: text('provider').notNull(),
    range: cidr('range').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.provider, t.range] }),
    // Finding the range an address is in.
    index('cloud_ip_ranges_range_idx').using('gist', t.range.op('inet_ops')),
  ],
);
