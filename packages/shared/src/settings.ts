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
  positionFreshMinutes: 5,
  boardNearKm: 5,
  ownAccountTriesPerDay: 3,
  smsCodesDailyAlert: 5_000,
  disputeSplitApprovalKobo: 2_000_000,
  busyAgentErrands: 50,
  approvalExpiryHours: 72,
  dailyIdReveals: 20,
  withdrawalHoldHours: 48,
  appPinTries: 5,
  dailySelfie: true,
  randomSelfiePercent: 0,
  attestation: 'record' as 'off' | 'record' | 'enforce',
  trailDays: 90,
  signedLinkMinutes: 5,
  releaseReminderHours: [2, 12, 20],
  idRevealAlertAt: 10,
  staffHoursStart: 7,
  staffHoursEnd: 21,
};

/** The Risk group's starting values, also used for versions saved before the group existed (E5, E6). */
export const DEFAULT_RISK_SETTINGS = {
  samePlaceMeters: 100,
  repeatPairingErrands: 5,
  repeatPairingDays: 30,
  fastHighValueKobo: 5_000_000,
  fastErrandMinutes: 10,
  sharedNetworkDays: 30,
  busyNetworkAccounts: 10,
  gpsMaxSpeedKmh: 150,
  gpsJumpMeters: 1_000,
  noMovementMeters: 150,
};

/** The Safety group's starting values (E9): Nigeria's emergency number. */
export const DEFAULT_SAFETY_SETTINGS = { emergencyNumber: '112' };

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
    /** Finished errands after which a customer no longer counts as new, for the item limit above. */
    newCustomerErrands: z.number().int().min(0).max(100).default(3),
    newAgentItemLimitKobo: kobo,
    newAgentDailyWithdrawalKobo: kobo,
    strikeThreshold: z.number().int().positive(),
    pinAttempts: z.number().int().positive(),
    otpAttempts: z.number().int().positive(),
    /** No longer used: sign-in codes are limited per 15 minutes and per day (below). Kept for older versions. */
    otpPerHour: z.number().int().positive(),
    /** Sign-in codes one number, or one phone, may ask for in 15 minutes, and in a day. */
    otpPerQuarterHour: z.number().int().min(1).max(20).default(3),
    otpPerDay: z.number().int().min(1).max(100).default(10),
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
    /** Identity checks one account may start in a day: each is a paid check, and could be a name lookup. */
    checkStartsPerDay: z.number().int().min(1).max(20).default(3),
  }),
  /**
   * How customers add money: a one-time account number for each top-up, and their own fixed account number
   * they can transfer any amount to at any time, where the payments provider in use issues them.
   */
  topUps: z
    .object({ oneTimeAccount: z.boolean(), fixedAccount: z.boolean() })
    .refine((t) => t.oneTimeAccount || t.fixedAccount, 'Keep at least one way to add money')
    // Each default is made afresh: zod hands a default back as it is, and one parse's copy mustn't be another's.
    .default(() => ({ oneTimeAccount: true, fixedAccount: false })),
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
      /**
       * How recent the agent's reported position must be, for the board and the drop-off checks. At most 30:
       * positions not refreshed for 30 minutes are deleted.
       */
      positionFreshMinutes: minutes.max(30).default(5),
      /** How far from their own position an agent may look at the board. */
      boardNearKm: z.number().int().min(1).max(50).default(5),
      /** Failed tries at an own account number (refused, or the bank unreachable) a customer gets in a day. */
      ownAccountTriesPerDay: z.number().int().min(1).max(20).default(3),
      /** Sign-in codes sent in the country in a day above which finance hears of it: each is a paid SMS. */
      smsCodesDailyAlert: z.number().int().min(1).max(1_000_000).default(5_000),
      /**
       * A dispute split paying the agent more than this (fee, items and wallet charge together) needs a second
       * admin's approval (D4, E7). 0 means every split does.
       */
      disputeSplitApprovalKobo: kobo.default(2_000_000),
      /** Suspending an agent with at least this many completed errands needs a second admin's approval (D4). */
      busyAgentErrands: z.number().int().min(1).max(100_000).default(50),
      /** How long a change waits for a second admin before it lapses and must be asked for again. */
      approvalExpiryHours: z
        .number()
        .int()
        .min(1)
        .max(24 * 14)
        .default(72),
      /** How many people's personal details one staff member may reveal in a day (D5). */
      dailyIdReveals: z.number().int().min(0).max(500).default(20),
      /**
       * How long an agent's withdrawals wait after a new payout account or a sign-in on a new phone (A6). It
       * can't be switched off.
       */
      withdrawalHoldHours: z
        .number()
        .int()
        .min(1)
        .max(24 * 7)
        .default(48),
      /** Wrong app PINs in a row before it locks until reset by signing in again (A7). */
      appPinTries: z.number().int().min(3).max(10).default(5),
      /** Agents pass a selfie check the first time they go online each day (I8). Each is a paid check. */
      dailySelfie: z.boolean().default(true),
      /**
       * After the day's check, the chance (in percent) that going online asks for another, at random (I8).
       * 0 means never. Each is a paid check.
       */
      randomSelfiePercent: z.number().int().min(0).max(100).default(0),
      /**
       * App attestation (MB3): Google Play Integrity and Apple App Attest show a request comes from the store
       * app on a real phone. record keeps each result for staff and risk signals without refusing anything;
       * enforce refuses a failed or missing one at sign-in, withdrawals, payout account changes and going
       * online, and asks a doubtful one for a selfie. Turn enforce on once both are set up.
       */
      attestation: z.enum(['off', 'record', 'enforce']).default('record'),
      /**
       * How long agents' GPS trails are kept (G4, X10), in days. Then they are deleted, unless the errand is
       * in dispute or a flag on it is still open.
       */
      trailDays: z.number().int().min(30).max(365).default(90),
      /**
       * How long a link to see a photo lasts once the app or the panel is given it (C1, X10), in minutes. The
       * photos themselves are never public.
       */
      signedLinkMinutes: minutes.max(60).default(5),
      /**
       * When the customer is reminded of a drop-off photo waiting for them, by push and SMS, in hours after the
       * agent sent it (X1, X3). Each is a paid SMS. One at or after the automatic approval is never sent.
       */
      releaseReminderHours: z
        .array(
          z
            .number()
            .int()
            .min(1)
            .max(24 * 7),
        )
        .max(6)
        .refine((h) => h.every((v, i) => i === 0 || v > h[i - 1]!), 'List the hours from soonest to latest, once each')
        .default(() => [2, 12, 20]),
      /**
       * How many people's personal details one staff member reveals in a day before owners are told (D8). Below
       * dailyIdReveals, which refuses any more.
       */
      idRevealAlertAt: z.number().int().min(1).max(500).default(10),
      /**
       * Staff working hours, in the country's own time: a money action or ID reveal before staffHoursStart or
       * from staffHoursEnd on raises an alert for owners (D8). 0 and 24 mean all day.
       */
      staffHoursStart: z.number().int().min(0).max(23).default(7),
      staffHoursEnd: z.number().int().min(1).max(24).default(21),
    })
    .refine((s) => s.staffHoursStart < s.staffHoursEnd, {
      path: ['staffHoursEnd'],
      message: 'Working hours end after they start',
    })
    .default(() => structuredClone(DEFAULT_SECURITY_SETTINGS)),
  /**
   * When errands are flagged for the Risk queue (docs/security-plan.md, E5, E6). A flag asks a person to look;
   * it refuses nothing.
   */
  risk: z
    .object({
      /** A pickup and a drop-off nearer than this count as the same place. 0 turns the flag off. */
      samePlaceMeters: z.number().int().min(0).max(5_000).default(100),
      /** The same customer and agent pairing this many times within repeatPairingDays is flagged. */
      repeatPairingErrands: z.number().int().min(2).max(1_000).default(5),
      repeatPairingDays: z.number().int().min(1).max(365).default(30),
      /** A Wi-Fi network or address both used within this many days counts as shared. */
      sharedNetworkDays: z.number().int().min(1).max(90).default(30),
      /**
       * An address more accounts than this used in those days is a busy one, such as a shop's or an office's
       * Wi-Fi, and isn't counted.
       */
      busyNetworkAccounts: z.number().int().min(2).max(1_000).default(10),
      /**
       * An agent's phone moving at least gpsJumpMeters between two reports, faster than this, is flagged: no
       * one travels that fast in a city (G1).
       */
      gpsMaxSpeedKmh: z.number().int().min(50).max(1_000).default(150),
      /** Smaller moves are a phone's GPS wandering, however fast they look. */
      gpsJumpMeters: z.number().int().min(100).max(50_000).default(1_000),
      /**
       * An errand whose trail stayed within this of where it started, over at least five minutes, while its
       * pickup and drop-off are more than twice this apart, is flagged (E6). 0 turns it off.
       */
      noMovementMeters: z.number().int().min(0).max(5_000).default(150),
      /** Errands worth at least this (fee and items) finished unusually fast are flagged. */
      fastHighValueKobo: kobo.default(5_000_000),
      /**
       * Unusually fast: from accepted to delivered in less than this, or than the route takes at 60 km/h,
       * whichever is longer.
       */
      fastErrandMinutes: z
        .number()
        .int()
        .min(1)
        .max(24 * 60)
        .default(10),
    })
    .default(() => structuredClone(DEFAULT_RISK_SETTINGS)),
  /** The emergency button (docs/security-plan.md, E9). */
  safety: z
    .object({
      /** The number the apps' emergency button dials from the phone. */
      emergencyNumber: z
        .string()
        .regex(/^\d{2,6}$/, 'An emergency number is 2 to 6 digits')
        .default('112'),
    })
    .default(() => structuredClone(DEFAULT_SAFETY_SETTINGS)),
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
    newCustomerErrands: 3,
    newAgentItemLimitKobo: 3_000_000,
    newAgentDailyWithdrawalKobo: 5_000_000,
    strikeThreshold: 3,
    pinAttempts: 5,
    otpAttempts: 5,
    otpPerHour: 5,
    otpPerQuarterHour: 3,
    otpPerDay: 10,
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
    checkStartsPerDay: 3,
  },
  topUps: { oneTimeAccount: true, fixedAccount: false },
  profiles: { showCustomerPhotoBeforeAccept: false },
  security: DEFAULT_SECURITY_SETTINGS,
  risk: DEFAULT_RISK_SETTINGS,
  safety: DEFAULT_SAFETY_SETTINGS,
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
    /** What the emergency button dials (E9). */
    safety: { emergencyNumber: s.safety.emergencyNumber },
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
    // Compared as sets; numbers in number order, so 2, 12, 20 doesn't read as 12, 2, 20.
    out.set(
      prefix,
      [...value].sort((x, y) =>
        typeof x === 'number' && typeof y === 'number'
          ? x - y
          : String(x) < String(y)
            ? -1
            : String(x) > String(y)
              ? 1
              : 0,
      ),
    );
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
