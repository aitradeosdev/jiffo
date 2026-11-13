import { z } from 'zod';
import { ID_TYPE_KEYS } from './identity';

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

/**
 * Everything admin can change for a country. Each saved change becomes a new version,
 * so an errand can always be explained by the settings that applied when it ran.
 */
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
    .refine((f) => f.serviceFeeMinKobo <= f.serviceFeeCapKobo, 'The service fee minimum must not exceed the cap'),
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
    mode: z.enum(['manual', 'provider']),
    provider: z.string().min(1).nullable(),
    customerIdTypes: z.array(z.enum(ID_TYPE_KEYS)).min(1),
    agentIdTypes: z.array(z.enum(ID_TYPE_KEYS)).min(1),
    requireBvnForAgents: z.boolean(),
    addressCheck: z.enum(['physical', 'digital']),
    selfieTries: z.number().int().positive(),
    reviewTargetHours: z.number().int().positive(),
  }),
  profiles: z.object({
    showCustomerPhotoBeforeAccept: z.boolean(),
  }),
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
    mode: 'manual',
    provider: null,
    customerIdTypes: ['nin', 'drivers_licence', 'voters_card', 'passport'],
    agentIdTypes: ['nin', 'bvn'],
    requireBvnForAgents: true,
    addressCheck: 'physical',
    selfieTries: 3,
    reviewTargetHours: 24,
  },
  profiles: { showCustomerPhotoBeforeAccept: false },
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
    identity: {
      mode: s.identity.mode,
      customerIdTypes: s.identity.customerIdTypes,
      agentIdTypes: s.identity.agentIdTypes,
    },
  };
}
export type PublicSettings = ReturnType<typeof publicSettings>;
