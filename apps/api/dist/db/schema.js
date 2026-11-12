"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.messages = exports.conversations = exports.errandEvents = exports.errandStops = exports.errands = exports.otpChallenges = exports.refreshTokens = exports.sessions = exports.devices = exports.APPS = exports.users = exports.categories = exports.settingsVersions = exports.states = exports.countries = void 0;
const pg_core_1 = require("drizzle-orm/pg-core");
const drizzle_orm_1 = require("drizzle-orm");
/** PostGIS point (longitude, latitude). Written with ST_MakePoint, read back through the lat/lng columns. */
const geographyPoint = (0, pg_core_1.customType)({
    dataType: () => 'geography(Point, 4326)',
});
const createdAt = () => (0, pg_core_1.timestamp)('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => (0, pg_core_1.timestamp)('updated_at', { withTimezone: true }).notNull().defaultNow();
const kobo = (name) => (0, pg_core_1.bigint)(name, { mode: 'number' });
/* ---------- Country adapter ---------- */
exports.countries = (0, pg_core_1.pgTable)('countries', {
    code: (0, pg_core_1.char)('code', { length: 2 }).primaryKey(),
    name: (0, pg_core_1.text)('name').notNull(),
    currency: (0, pg_core_1.char)('currency', { length: 3 }).notNull(),
    phonePrefix: (0, pg_core_1.text)('phone_prefix').notNull(),
    timezone: (0, pg_core_1.text)('timezone').notNull(),
    enabled: (0, pg_core_1.boolean)('enabled').notNull().default(false),
});
exports.states = (0, pg_core_1.pgTable)('states', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    countryCode: (0, pg_core_1.char)('country_code', { length: 2 })
        .notNull()
        .references(() => exports.countries.code),
    code: (0, pg_core_1.text)('code').notNull(),
    name: (0, pg_core_1.text)('name').notNull(),
    enabled: (0, pg_core_1.boolean)('enabled').notNull().default(false),
    agentSignups: (0, pg_core_1.text)('agent_signups', { enum: ['open', 'waitlist'] })
        .notNull()
        .default('open'),
}, (t) => [(0, pg_core_1.uniqueIndex)('states_country_code_uq').on(t.countryCode, t.code)]);
/** Every saved change to a country's settings is a new version; the highest version is current. */
exports.settingsVersions = (0, pg_core_1.pgTable)('settings_versions', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    countryCode: (0, pg_core_1.char)('country_code', { length: 2 })
        .notNull()
        .references(() => exports.countries.code),
    version: (0, pg_core_1.integer)('version').notNull(),
    data: (0, pg_core_1.jsonb)('data').$type().notNull(),
    createdBy: (0, pg_core_1.uuid)('created_by'),
    createdAt: createdAt(),
}, (t) => [(0, pg_core_1.uniqueIndex)('settings_country_version_uq').on(t.countryCode, t.version)]);
exports.categories = (0, pg_core_1.pgTable)('categories', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    countryCode: (0, pg_core_1.char)('country_code', { length: 2 })
        .notNull()
        .references(() => exports.countries.code),
    key: (0, pg_core_1.text)('key').notNull(),
    name: (0, pg_core_1.text)('name').notNull(),
    icon: (0, pg_core_1.text)('icon').notNull(),
    description: (0, pg_core_1.text)('description').notNull().default(''),
    buyDefault: (0, pg_core_1.boolean)('buy_default').notNull().default(false),
    sort: (0, pg_core_1.integer)('sort').notNull().default(0),
    active: (0, pg_core_1.boolean)('active').notNull().default(true),
    deletedAt: (0, pg_core_1.timestamp)('deleted_at', { withTimezone: true }),
    createdAt: createdAt(),
}, (t) => [
    (0, pg_core_1.uniqueIndex)('categories_country_key_uq')
        .on(t.countryCode, t.key)
        .where((0, drizzle_orm_1.sql) `${t.deletedAt} is null`),
]);
/* ---------- Accounts and sessions ---------- */
exports.users = (0, pg_core_1.pgTable)('users', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    phone: (0, pg_core_1.text)('phone').notNull().unique(),
    countryCode: (0, pg_core_1.char)('country_code', { length: 2 })
        .notNull()
        .references(() => exports.countries.code),
    firstName: (0, pg_core_1.text)('first_name'),
    lastName: (0, pg_core_1.text)('last_name'),
    email: (0, pg_core_1.text)('email'),
    status: (0, pg_core_1.text)('status', { enum: ['active', 'suspended'] })
        .notNull()
        .default('active'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
});
exports.APPS = ['customer', 'agent'];
/** A phone running one of the apps. Sessions and push tokens hang off it. */
exports.devices = (0, pg_core_1.pgTable)('devices', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    userId: (0, pg_core_1.uuid)('user_id')
        .notNull()
        .references(() => exports.users.id),
    deviceKey: (0, pg_core_1.text)('device_key').notNull(),
    app: (0, pg_core_1.text)('app', { enum: exports.APPS }).notNull(),
    platform: (0, pg_core_1.text)('platform', { enum: ['ios', 'android', 'web'] }).notNull(),
    name: (0, pg_core_1.text)('name'),
    pushToken: (0, pg_core_1.text)('push_token'),
    pushUpdatedAt: (0, pg_core_1.timestamp)('push_updated_at', { withTimezone: true }),
    lastSeenAt: (0, pg_core_1.timestamp)('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
}, (t) => [(0, pg_core_1.uniqueIndex)('devices_user_key_app_uq').on(t.userId, t.deviceKey, t.app)]);
exports.sessions = (0, pg_core_1.pgTable)('sessions', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    userId: (0, pg_core_1.uuid)('user_id')
        .notNull()
        .references(() => exports.users.id),
    deviceId: (0, pg_core_1.uuid)('device_id')
        .notNull()
        .references(() => exports.devices.id),
    app: (0, pg_core_1.text)('app', { enum: exports.APPS }).notNull(),
    expiresAt: (0, pg_core_1.timestamp)('expires_at', { withTimezone: true }).notNull(),
    revokedAt: (0, pg_core_1.timestamp)('revoked_at', { withTimezone: true }),
    revokedReason: (0, pg_core_1.text)('revoked_reason'),
    createdAt: createdAt(),
}, (t) => [(0, pg_core_1.index)('sessions_user_idx').on(t.userId)]);
/** Refresh tokens rotate on every use. Presenting a used one again revokes the whole session. */
exports.refreshTokens = (0, pg_core_1.pgTable)('refresh_tokens', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    sessionId: (0, pg_core_1.uuid)('session_id')
        .notNull()
        .references(() => exports.sessions.id),
    tokenHash: (0, pg_core_1.text)('token_hash').notNull(),
    usedAt: (0, pg_core_1.timestamp)('used_at', { withTimezone: true }),
    expiresAt: (0, pg_core_1.timestamp)('expires_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
}, (t) => [(0, pg_core_1.uniqueIndex)('refresh_tokens_hash_uq').on(t.tokenHash), (0, pg_core_1.index)('refresh_tokens_session_idx').on(t.sessionId)]);
exports.otpChallenges = (0, pg_core_1.pgTable)('otp_challenges', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    phone: (0, pg_core_1.text)('phone').notNull(),
    codeHash: (0, pg_core_1.text)('code_hash').notNull(),
    requestedIp: (0, pg_core_1.text)('requested_ip'),
    attempts: (0, pg_core_1.smallint)('attempts').notNull().default(0),
    expiresAt: (0, pg_core_1.timestamp)('expires_at', { withTimezone: true }).notNull(),
    consumedAt: (0, pg_core_1.timestamp)('consumed_at', { withTimezone: true }),
    createdAt: createdAt(),
}, (t) => [
    (0, pg_core_1.index)('otp_phone_created_idx').on(t.phone, t.createdAt),
    (0, pg_core_1.index)('otp_ip_created_idx').on(t.requestedIp, t.createdAt),
]);
/* ---------- Errands ---------- */
exports.errands = (0, pg_core_1.pgTable)('errands', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    countryCode: (0, pg_core_1.char)('country_code', { length: 2 })
        .notNull()
        .references(() => exports.countries.code),
    stateCode: (0, pg_core_1.text)('state_code').notNull(),
    customerId: (0, pg_core_1.uuid)('customer_id')
        .notNull()
        .references(() => exports.users.id),
    agentId: (0, pg_core_1.uuid)('agent_id').references(() => exports.users.id),
    categoryKey: (0, pg_core_1.text)('category_key').notNull(),
    buy: (0, pg_core_1.boolean)('buy').notNull(),
    urgent: (0, pg_core_1.boolean)('urgent').notNull().default(false),
    description: (0, pg_core_1.text)('description').notNull(),
    status: (0, pg_core_1.text)('status').$type().notNull(),
    feeKobo: kobo('fee_kobo').notNull(),
    pendingOfferKobo: kobo('pending_offer_kobo'),
    itemAmountKobo: kobo('item_amount_kobo'),
    scheduledFor: (0, pg_core_1.timestamp)('scheduled_for', { withTimezone: true }),
    settingsVersion: (0, pg_core_1.integer)('settings_version').notNull(),
    pinCipher: (0, pg_core_1.text)('pin_cipher'),
    pinAttempts: (0, pg_core_1.smallint)('pin_attempts').notNull().default(0),
    version: (0, pg_core_1.integer)('version').notNull().default(0),
    acceptedAt: (0, pg_core_1.timestamp)('accepted_at', { withTimezone: true }),
    startedAt: (0, pg_core_1.timestamp)('started_at', { withTimezone: true }),
    deliveredAt: (0, pg_core_1.timestamp)('delivered_at', { withTimezone: true }),
    completedAt: (0, pg_core_1.timestamp)('completed_at', { withTimezone: true }),
    cancelledAt: (0, pg_core_1.timestamp)('cancelled_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
}, (t) => [
    (0, pg_core_1.index)('errands_customer_idx').on(t.customerId, t.createdAt),
    (0, pg_core_1.index)('errands_agent_idx').on(t.agentId, t.createdAt),
    (0, pg_core_1.index)('errands_status_idx').on(t.status),
]);
exports.errandStops = (0, pg_core_1.pgTable)('errand_stops', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    errandId: (0, pg_core_1.uuid)('errand_id')
        .notNull()
        .references(() => exports.errands.id),
    seq: (0, pg_core_1.smallint)('seq').notNull(),
    kind: (0, pg_core_1.text)('kind', { enum: ['pickup', 'stop', 'dropoff'] }).notNull(),
    label: (0, pg_core_1.text)('label'),
    address: (0, pg_core_1.text)('address').notNull(),
    lat: (0, pg_core_1.doublePrecision)('lat').notNull(),
    lng: (0, pg_core_1.doublePrecision)('lng').notNull(),
    location: geographyPoint('location').notNull(),
}, (t) => [
    (0, pg_core_1.uniqueIndex)('errand_stops_seq_uq').on(t.errandId, t.seq),
    (0, pg_core_1.index)('errand_stops_location_gix').using('gist', t.location),
]);
/** Every change to an errand, in order. It feeds the tracker timeline, notifications and dispute evidence. */
exports.errandEvents = (0, pg_core_1.pgTable)('errand_events', {
    id: (0, pg_core_1.bigserial)('id', { mode: 'number' }).primaryKey(),
    errandId: (0, pg_core_1.uuid)('errand_id')
        .notNull()
        .references(() => exports.errands.id),
    event: (0, pg_core_1.text)('event').notNull(),
    fromStatus: (0, pg_core_1.text)('from_status').$type(),
    toStatus: (0, pg_core_1.text)('to_status').$type().notNull(),
    actorRole: (0, pg_core_1.text)('actor_role', { enum: ['customer', 'agent', 'system', 'admin'] }).notNull(),
    actorId: (0, pg_core_1.uuid)('actor_id'),
    data: (0, pg_core_1.jsonb)('data').$type().notNull().default({}),
    createdAt: createdAt(),
}, (t) => [(0, pg_core_1.index)('errand_events_errand_idx').on(t.errandId, t.id)]);
/* ---------- Chat ---------- */
/** One conversation per agent assignment, so a new agent never sees what the customer said to the last one. */
exports.conversations = (0, pg_core_1.pgTable)('conversations', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    errandId: (0, pg_core_1.uuid)('errand_id')
        .notNull()
        .references(() => exports.errands.id),
    customerId: (0, pg_core_1.uuid)('customer_id')
        .notNull()
        .references(() => exports.users.id),
    agentId: (0, pg_core_1.uuid)('agent_id')
        .notNull()
        .references(() => exports.users.id),
    /** Set when the agent leaves or the errand ends; the conversation is read-only from then on. */
    closedAt: (0, pg_core_1.timestamp)('closed_at', { withTimezone: true }),
    createdAt: createdAt(),
}, (t) => [(0, pg_core_1.uniqueIndex)('conversations_errand_agent_uq').on(t.errandId, t.agentId)]);
exports.messages = (0, pg_core_1.pgTable)('messages', {
    id: (0, pg_core_1.bigserial)('id', { mode: 'number' }).primaryKey(),
    conversationId: (0, pg_core_1.uuid)('conversation_id')
        .notNull()
        .references(() => exports.conversations.id),
    senderId: (0, pg_core_1.uuid)('sender_id').references(() => exports.users.id),
    senderRole: (0, pg_core_1.text)('sender_role', { enum: ['customer', 'agent', 'system'] }).notNull(),
    clientId: (0, pg_core_1.text)('client_id'),
    kind: (0, pg_core_1.text)('kind', { enum: ['text', 'system'] }).notNull(),
    body: (0, pg_core_1.text)('body').notNull(),
    data: (0, pg_core_1.jsonb)('data').$type().notNull().default({}),
    createdAt: createdAt(),
}, (t) => [
    (0, pg_core_1.index)('messages_conversation_idx').on(t.conversationId, t.id),
    (0, pg_core_1.uniqueIndex)('messages_client_id_uq').on(t.conversationId, t.senderId, t.clientId),
]);
//# sourceMappingURL=schema.js.map