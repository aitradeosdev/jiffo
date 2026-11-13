import {
  bigint,
  bigserial,
  boolean,
  char,
  check,
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
import { ADMIN_ROLES, AGENT_TIERS, type AdminRole, type CountrySettings, type ErrandState } from '@jiffo/shared';

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

/** Agent-only details. A row is created the first time an agent's profile is read or changed. */
export const AGENT_PROFILE_DEFAULTS = { tier: 'bronze', categoryKeys: null, takesPurchases: true } as const;
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
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [check('agent_profiles_tier_ck', tierCheck(t.tier))],
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
    location: geographyPoint('location'),
    locatedAt: timestamp('located_at', { withTimezone: true }),
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
    allowNegative: boolean('allow_negative').notNull().default(false),
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
    check('ledger_accounts_balance_ck', sql`${t.allowNegative} or ${t.balance} >= 0`),
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
    amountKobo: kobo('amount_kobo').notNull(),
    accountNumber: text('account_number').notNull(),
    accountName: text('account_name').notNull(),
    bankName: text('bank_name').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    /** What the provider says arrived, which is what the wallet is credited with. */
    paidKobo: kobo('paid_kobo'),
    feesKobo: kobo('fees_kobo'),
    senderName: text('sender_name'),
    senderBank: text('sender_bank'),
    /** The sender's name does not match the customer's: shown to admin as a fraud signal. */
    senderMismatch: boolean('sender_mismatch').notNull().default(false),
    createdAt: createdAt(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('deposits_reference_uq').on(t.reference),
    index('deposits_user_idx').on(t.userId, t.createdAt),
    // The admin list: a country's top-ups, newest first.
    index('deposits_country_created_idx').on(t.countryCode, t.createdAt, t.id),
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
    accountNumber: text('account_number').notNull(),
    accountName: text('account_name').notNull(),
    recipientCode: text('recipient_code').notNull(),
    createdAt: createdAt(),
    replacedAt: timestamp('replaced_at', { withTimezone: true }),
  },
  (t) => [
    index('payout_accounts_user_idx').on(t.userId),
    uniqueIndex('payout_accounts_current_uq')
      .on(t.userId)
      .where(sql`${t.replacedAt} is null`),
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
    createdAt: createdAt(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('payouts_reference_uq').on(t.reference),
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
  createdAt: createdAt(),
});

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
    contentType: text('content_type').notNull(),
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
     * HMAC of the NIN: equal NINs give equal fingerprints, and the NIN can't be read back. It is claimed here
     * only once the provider has confirmed the NIN and that the selfie matches its owner; until then it waits
     * in pendingNinFingerprint, so typing someone else's NIN reserves nothing.
     */
    ninFingerprint: text('nin_fingerprint'),
    pendingNinFingerprint: text('pending_nin_fingerprint'),
    /** The identity provider the check was started with; it finishes there even if admin switches. */
    identityProvider: text('identity_provider'),
    identityReference: text('identity_reference'),
    identityOutcome: text('identity_outcome', { enum: ['passed', 'failed', 'review'] }),
    identityCheckedAt: timestamp('identity_checked_at', { withTimezone: true }),
    legalName: text('legal_name'),
    dateOfBirth: text('date_of_birth'),
    /** Only our safety team sees it. */
    address: text('address'),
    emergencyName: text('emergency_name'),
    emergencyPhone: text('emergency_phone'),
    emergencyRelationship: text('emergency_relationship'),
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
      .on(t.ninFingerprint)
      .where(sql`${t.ninFingerprint} is not null`),
    index('agent_applications_status_idx').on(t.countryCode, t.status),
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
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('admin_sessions_token_uq').on(t.tokenHash), index('admin_sessions_admin_idx').on(t.adminId)],
);

/** Every admin sign-in attempt, kept for the lockouts and as a record. Unknown emails are recorded too. */
export const adminSignInAttempts = pgTable(
  'admin_sign_in_attempts',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    email: text('email').notNull(),
    ip: text('ip'),
    stage: text('stage', { enum: ['password', 'code'] }).notNull(),
    succeeded: boolean('succeeded').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('admin_attempts_email_idx').on(t.email, t.createdAt),
    index('admin_attempts_ip_idx').on(t.ip, t.createdAt),
  ],
);

/** What admins changed, written in the same transaction as the change itself. */
export const adminAudit = pgTable(
  'admin_audit',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    adminId: uuid('admin_id')
      .notNull()
      .references(() => admins.id),
    /** For example team.invite, errand.resolve or wallet.adjust. */
    action: text('action').notNull(),
    targetType: text('target_type'),
    targetId: text('target_id'),
    countryCode: char('country_code', { length: 2 }),
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
    ip: text('ip'),
    createdAt: createdAt(),
  },
  (t) => [
    index('admin_audit_created_idx').on(t.createdAt),
    index('admin_audit_target_idx').on(t.targetType, t.targetId),
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

/**
 * Identity results a provider sent by webhook, until the application picks them up: only the outcome, the
 * legal name, date of birth and the NIN's fingerprint. The provider's payload, which carries more, is never kept.
 */
export const identityResults = pgTable(
  'identity_results',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    provider: text('provider').notNull(),
    reference: text('reference').notNull(),
    outcome: text('outcome', { enum: ['passed', 'failed', 'review'] }).notNull(),
    legalName: text('legal_name'),
    dateOfBirth: text('date_of_birth'),
    checks: jsonb('checks').$type<Array<{ key: string; outcome: string; note?: string }>>().notNull().default([]),
    ninFingerprint: text('nin_fingerprint'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('identity_results_uq').on(t.provider, t.reference)],
);
