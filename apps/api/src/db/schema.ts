import {
  bigint,
  bigserial,
  boolean,
  char,
  customType,
  doublePrecision,
  index,
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
import type { CountrySettings, ErrandState } from '@jiffo/shared';

/** PostGIS point (longitude, latitude). Written with ST_MakePoint, read back through the lat/lng columns. */
const geographyPoint = customType<{ data: string; driverData: string }>({
  dataType: () => 'geography(Point, 4326)',
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

export const users = pgTable('users', {
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
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

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
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('devices_user_key_app_uq').on(t.userId, t.deviceKey, t.app)],
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
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
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
    requestedIp: text('requested_ip'),
    attempts: smallint('attempts').notNull().default(0),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index('otp_phone_created_idx').on(t.phone, t.createdAt),
    index('otp_ip_created_idx').on(t.requestedIp, t.createdAt),
  ],
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
    pendingOfferKobo: kobo('pending_offer_kobo'),
    itemAmountKobo: kobo('item_amount_kobo'),
    scheduledFor: timestamp('scheduled_for', { withTimezone: true }),
    settingsVersion: integer('settings_version').notNull(),
    pinCipher: text('pin_cipher'),
    pinAttempts: smallint('pin_attempts').notNull().default(0),
    version: integer('version').notNull().default(0),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('errands_customer_idx').on(t.customerId, t.createdAt),
    index('errands_agent_idx').on(t.agentId, t.createdAt),
    index('errands_status_idx').on(t.status),
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
  (t) => [index('errand_events_errand_idx').on(t.errandId, t.id)],
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
    kind: text('kind', { enum: ['text', 'system'] }).notNull(),
    body: text('body').notNull(),
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [
    index('messages_conversation_idx').on(t.conversationId, t.id),
    uniqueIndex('messages_client_id_uq').on(t.conversationId, t.senderId, t.clientId),
  ],
);
