import { z } from 'zod';
import { ID_TYPE_KEYS, CUSTOMER_ID_TYPES } from './identity';

const kobo = z.number().int().nonnegative();
const bps = z.number().int().min(0).max(10_000);
const minutes = z.number().int().positive();

export const AGENT_TIERS = ['bronze', 'silver', 'gold', 'platinum'] as const;
export type AgentTier = (typeof AGENT_TIERS)[number];

export const AGENT_TIER_LABELS: Record<AgentTier, string> = {
  bronze: 'Bronze',
  silver: 'Silver',
  gold: 'Gold',
  platinum: 'Platinum',
};

/** A tier's name for people, or the raw value for one this version doesn't know. */
export const agentTierLabel = (tier: string) => AGENT_TIER_LABELS[tier as AgentTier] ?? tier;

/** The Security group's starting values, also used for versions saved before the group existed. */
export const DEFAULT_SECURITY_SETTINGS = {
  instantWithdrawalAgentDailyKobo: 20_000_000,
  instantWithdrawalPlatformDailyKobo: 1_000_000_000,
  reconciliationToleranceKobo: 50_000,
  lowProviderBalanceKobo: 50_000_000,
  handoffDistanceMeters: 200,
  offersPerMinute: 5,
  maxActiveErrandsPerAgent: 0,
};

/**
 * Everything admin can change for a country. Each saved change becomes a new version,
 * so an errand can always be explained by the settings that applied when it ran.
 */
/**
 * Customers' IDs as saved before they were limited to the NIN and BVN: a list with an ID document in it
 * meant customers had a choice, which is now the NIN or the BVN; any other list is kept as it is.
 */
export function customerIdTypesOf(value: unknown) {
  if (!Array.isArray(value)) return value;
  const numbers = (CUSTOMER_ID_TYPES as readonly unknown[]).includes.bind(CUSTOMER_ID_TYPES);
  return value.every(numbers) ? value : [...CUSTOMER_ID_TYPES];
}

export const CountrySettingsSchema = z.object({
  pricing: z.object({
    baseFeeKobo: kobo,
    ratePerKmKobo: kobo,
    minFeeKobo: kobo,
  }),
  fees: z
    .object({
      serviceFeeBps: bps,
      serviceFeeMinKobo: kobo,
      serviceFeeCapKobo: kobo,
      commissionBps: z.object({ bronze: bps, silver: bps, gold: bps, platinum: bps }),
      launchCommissionBps: bps.nullable(),
      instantWithdrawalFeeKobo: kobo,
    })
    .refine((f) => f.serviceFeeMinKobo <= f.serviceFeeCapKobo, {
      message: 'The service fee minimum must not exceed the cap',
      path: ['serviceFeeMinKobo'],
    }),
  timers: z.object({
    urgentWidenMinutes: minutes,
    raisePricePromptMinutes: minutes,
    urgentExpiryMinutes: minutes,
    boardRaisePromptMinutes: minutes,
    itemLockMinutes: minutes,
    dropoffWaitMinutes: minutes,
    autoReleaseHours: minutes,
    unreachableHours: minutes,
    disputeResponseHours: minutes,
    disputeDecisionHours: minutes,
    bronzePayoutHoldHours: minutes,
    /** How long the one-time account number for a bank-transfer top-up stays open. */
    depositAccountMinutes: minutes.default(30),
  }),
  limits: z.object({
    newCustomerItemLimitKobo: kobo,
    newAgentItemLimitKobo: kobo,
    newAgentDailyWithdrawalKobo: kobo,
    strikeThreshold: z.number().int().positive(),
    pinAttempts: z.number().int().positive(),
    otpAttempts: z.number().int().positive(),
    otpPerHour: z.number().int().positive(),
    otpResendSeconds: z.number().int().positive(),
    otpTtlSeconds: z.number().int().positive(),
    minDepositKobo: kobo.default(10_000),
    /** No deposit limit by default; admin can set one. */
    maxDepositKobo: kobo.nullable().default(null),
    minWithdrawalKobo: kobo.default(10_000),
  }),
  identity: z.object({
    /**
     * IDs a customer may verify with, one of them: the NIN or BVN, with a selfie. Settings saved when ID
     * documents could be chosen for customers read as both numbers (see customerIdTypesOf); saving such a
     * list is refused.
     */
    customerIdTypes: z.preprocess(customerIdTypesOf, z.array(z.enum(CUSTOMER_ID_TYPES)).min(1)),
    /** IDs an agent may verify with, one of them. */
    agentIdTypes: z.array(z.enum(ID_TYPE_KEYS)).min(1),
    requireBvnForAgents: z.boolean(),
    addressCheck: z.enum(['physical', 'digital']),
    selfieTries: z.number().int().positive(),
    reviewTargetHours: z.number().int().positive(),
  }),
  /**
   * How customers add money: a one-time account number for each top-up, and their own fixed account number
   * they can transfer any amount to at any time, where the payments provider in use issues them.
   */
  topUps: z
    .object({ oneTimeAccount: z.boolean(), fixedAccount: z.boolean() })
    .refine((t) => t.oneTimeAccount || t.fixedAccount, 'Keep at least one way to add money')
    .default({ oneTimeAccount: true, fixedAccount: false }),
  profiles: z.object({
    showCustomerPhotoBeforeAccept: z.boolean(),
  }),
  /** Limits that protect the money (docs/security-plan.md, X10). */
  security: z
    .object({
      /** Instant withdrawals one agent may take a day, fee included. */
      instantWithdrawalAgentDailyKobo: kobo,
      /** Instant withdrawals all agents in the country may take a day. */
      instantWithdrawalPlatformDailyKobo: kobo,
      /** A nightly-check shortfall larger than this pauses instant withdrawals until finance clears it. */
      reconciliationToleranceKobo: kobo,
      /** Below this, the money held at the payments provider raises an alert. */
      lowProviderBalanceKobo: kobo,
      /** How near the drop-off the agent must be to mark it delivered and take the PIN. 0 turns it off. */
      handoffDistanceMeters: z.number().int().min(0).max(5_000).default(200),
      /** Counter-offers an agent may send on one errand in a minute. */
      offersPerMinute: z.number().int().min(1).max(60).default(5),
      /** Errands one agent may hold at once, from accepted until done. 0 means no limit. */
      maxActiveErrandsPerAgent: z.number().int().min(0).max(20).default(0),
    })
    .default(DEFAULT_SECURITY_SETTINGS),
});

export type CountrySettings = z.infer<typeof CountrySettingsSchema>;

/**
 * Nigeria's starting values. The spec leaves the percentages and amounts to admin before launch;
 * these are the sample figures the prototypes use, to be replaced in admin.
 */
export const NIGERIA_DEFAULT_SETTINGS: CountrySettings = {
  pricing: { baseFeeKobo: 50_000, ratePerKmKobo: 20_000, minFeeKobo: 100_000 },
  fees: {
    serviceFeeBps: 1_000,
    serviceFeeMinKobo: 10_000,
    serviceFeeCapKobo: 100_000,
    commissionBps: { bronze: 1_500, silver: 1_250, gold: 1_000, platinum: 800 },
    launchCommissionBps: null,
    instantWithdrawalFeeKobo: 10_000,
  },
  timers: {
    urgentWidenMinutes: 5,
    raisePricePromptMinutes: 15,
    urgentExpiryMinutes: 30,
    boardRaisePromptMinutes: 30,
    itemLockMinutes: 30,
    dropoffWaitMinutes: 10,
    autoReleaseHours: 24,
    unreachableHours: 24,
    disputeResponseHours: 24,
    disputeDecisionHours: 48,
    bronzePayoutHoldHours: 24,
    depositAccountMinutes: 30,
  },
  limits: {
    newCustomerItemLimitKobo: 5_000_000,
    newAgentItemLimitKobo: 3_000_000,
    newAgentDailyWithdrawalKobo: 5_000_000,
    strikeThreshold: 3,
    pinAttempts: 5,
    otpAttempts: 5,
    otpPerHour: 5,
    otpResendSeconds: 60,
    otpTtlSeconds: 300,
    minDepositKobo: 10_000,
    maxDepositKobo: null,
    minWithdrawalKobo: 10_000,
  },
  identity: {
    customerIdTypes: ['nin', 'bvn'],
    agentIdTypes: ['nin', 'bvn'],
    requireBvnForAgents: true,
    addressCheck: 'physical',
    selfieTries: 3,
    reviewTargetHours: 24,
  },
  topUps: { oneTimeAccount: true, fixedAccount: false },
  profiles: { showCustomerPhotoBeforeAccept: false },
  security: DEFAULT_SECURITY_SETTINGS,
};

/** The part of the settings the apps may read. Limits and identity provider details stay on the server. */
export function publicSettings(s: CountrySettings) {
  return {
    pricing: s.pricing,
    fees: {
      serviceFeeBps: s.fees.serviceFeeBps,
      serviceFeeMinKobo: s.fees.serviceFeeMinKobo,
      serviceFeeCapKobo: s.fees.serviceFeeCapKobo,
    },
    timers: s.timers,
    /** Only the amounts the apps check before sending; fraud limits stay on the server. */
    wallet: {
      minDepositKobo: s.limits.minDepositKobo,
      maxDepositKobo: s.limits.maxDepositKobo,
      minWithdrawalKobo: s.limits.minWithdrawalKobo,
    },
    /** The ways to add money admin turned on (a fixed account also needs a provider that issues them). */
    topUps: s.topUps,
    identity: {
      customerIdTypes: s.identity.customerIdTypes,
      agentIdTypes: s.identity.agentIdTypes,
    },
  };
}
export type PublicSettings = ReturnType<typeof publicSettings>;

/** One changed setting, by its dotted path, e.g. fees.commissionBps.gold. */
export interface SettingChange {
  path: string;
  from: unknown;
  to: unknown;
}

/** Every value by its dotted path. Lists are kept whole, in sorted order: they are sets of choices. */
function flattenSettings(value: unknown, prefix = '', out = new Map<string, unknown>()) {
  if (Array.isArray(value)) {
    out.set(prefix, [...value].sort());
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) flattenSettings(v, prefix ? `${prefix}.${k}` : k, out);
  } else {
    out.set(prefix, value ?? null);
  }
  return out;
}

/** What differs between two settings objects (or any two plain objects), setting by setting. */
export function settingChanges(before: unknown, after: unknown): SettingChange[] {
  const a = flattenSettings(before);
  const b = flattenSettings(after);
  return [...new Set([...a.keys(), ...b.keys()])]
    .sort()
    .filter((p) => JSON.stringify(a.get(p) ?? null) !== JSON.stringify(b.get(p) ?? null))
    .map((p) => ({ path: p, from: a.get(p) ?? null, to: b.get(p) ?? null }));
}
