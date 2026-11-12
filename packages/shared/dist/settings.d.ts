import { z } from 'zod';
export declare const AGENT_TIERS: readonly ["bronze", "silver", "gold", "platinum"];
export type AgentTier = (typeof AGENT_TIERS)[number];
/**
 * Everything admin can change for a country. Each saved change becomes a new version,
 * so an errand can always be explained by the settings that applied when it ran.
 */
export declare const CountrySettingsSchema: z.ZodObject<{
    pricing: z.ZodObject<{
        baseFeeKobo: z.ZodNumber;
        ratePerKmKobo: z.ZodNumber;
        minFeeKobo: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        baseFeeKobo: number;
        ratePerKmKobo: number;
        minFeeKobo: number;
    }, {
        baseFeeKobo: number;
        ratePerKmKobo: number;
        minFeeKobo: number;
    }>;
    fees: z.ZodEffects<z.ZodObject<{
        serviceFeeBps: z.ZodNumber;
        serviceFeeMinKobo: z.ZodNumber;
        serviceFeeCapKobo: z.ZodNumber;
        commissionBps: z.ZodObject<{
            bronze: z.ZodNumber;
            silver: z.ZodNumber;
            gold: z.ZodNumber;
            platinum: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            bronze: number;
            silver: number;
            gold: number;
            platinum: number;
        }, {
            bronze: number;
            silver: number;
            gold: number;
            platinum: number;
        }>;
        launchCommissionBps: z.ZodNullable<z.ZodNumber>;
        instantWithdrawalFeeKobo: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        serviceFeeBps: number;
        serviceFeeMinKobo: number;
        serviceFeeCapKobo: number;
        commissionBps: {
            bronze: number;
            silver: number;
            gold: number;
            platinum: number;
        };
        launchCommissionBps: number | null;
        instantWithdrawalFeeKobo: number;
    }, {
        serviceFeeBps: number;
        serviceFeeMinKobo: number;
        serviceFeeCapKobo: number;
        commissionBps: {
            bronze: number;
            silver: number;
            gold: number;
            platinum: number;
        };
        launchCommissionBps: number | null;
        instantWithdrawalFeeKobo: number;
    }>, {
        serviceFeeBps: number;
        serviceFeeMinKobo: number;
        serviceFeeCapKobo: number;
        commissionBps: {
            bronze: number;
            silver: number;
            gold: number;
            platinum: number;
        };
        launchCommissionBps: number | null;
        instantWithdrawalFeeKobo: number;
    }, {
        serviceFeeBps: number;
        serviceFeeMinKobo: number;
        serviceFeeCapKobo: number;
        commissionBps: {
            bronze: number;
            silver: number;
            gold: number;
            platinum: number;
        };
        launchCommissionBps: number | null;
        instantWithdrawalFeeKobo: number;
    }>;
    timers: z.ZodObject<{
        urgentWidenMinutes: z.ZodNumber;
        raisePricePromptMinutes: z.ZodNumber;
        urgentExpiryMinutes: z.ZodNumber;
        boardRaisePromptMinutes: z.ZodNumber;
        itemLockMinutes: z.ZodNumber;
        dropoffWaitMinutes: z.ZodNumber;
        autoReleaseHours: z.ZodNumber;
        unreachableHours: z.ZodNumber;
        disputeResponseHours: z.ZodNumber;
        disputeDecisionHours: z.ZodNumber;
        bronzePayoutHoldHours: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        urgentWidenMinutes: number;
        raisePricePromptMinutes: number;
        urgentExpiryMinutes: number;
        boardRaisePromptMinutes: number;
        itemLockMinutes: number;
        dropoffWaitMinutes: number;
        autoReleaseHours: number;
        unreachableHours: number;
        disputeResponseHours: number;
        disputeDecisionHours: number;
        bronzePayoutHoldHours: number;
    }, {
        urgentWidenMinutes: number;
        raisePricePromptMinutes: number;
        urgentExpiryMinutes: number;
        boardRaisePromptMinutes: number;
        itemLockMinutes: number;
        dropoffWaitMinutes: number;
        autoReleaseHours: number;
        unreachableHours: number;
        disputeResponseHours: number;
        disputeDecisionHours: number;
        bronzePayoutHoldHours: number;
    }>;
    limits: z.ZodObject<{
        newCustomerItemLimitKobo: z.ZodNumber;
        newAgentItemLimitKobo: z.ZodNumber;
        newAgentDailyWithdrawalKobo: z.ZodNumber;
        strikeThreshold: z.ZodNumber;
        pinAttempts: z.ZodNumber;
        otpAttempts: z.ZodNumber;
        otpPerHour: z.ZodNumber;
        otpResendSeconds: z.ZodNumber;
        otpTtlSeconds: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        newCustomerItemLimitKobo: number;
        newAgentItemLimitKobo: number;
        newAgentDailyWithdrawalKobo: number;
        strikeThreshold: number;
        pinAttempts: number;
        otpAttempts: number;
        otpPerHour: number;
        otpResendSeconds: number;
        otpTtlSeconds: number;
    }, {
        newCustomerItemLimitKobo: number;
        newAgentItemLimitKobo: number;
        newAgentDailyWithdrawalKobo: number;
        strikeThreshold: number;
        pinAttempts: number;
        otpAttempts: number;
        otpPerHour: number;
        otpResendSeconds: number;
        otpTtlSeconds: number;
    }>;
    identity: z.ZodObject<{
        mode: z.ZodEnum<["manual", "provider"]>;
        provider: z.ZodNullable<z.ZodString>;
        customerIdTypes: z.ZodArray<z.ZodEnum<["nin" | "bvn" | "drivers_licence" | "voters_card" | "passport", ...("nin" | "bvn" | "drivers_licence" | "voters_card" | "passport")[]]>, "many">;
        agentIdTypes: z.ZodArray<z.ZodEnum<["nin" | "bvn" | "drivers_licence" | "voters_card" | "passport", ...("nin" | "bvn" | "drivers_licence" | "voters_card" | "passport")[]]>, "many">;
        requireBvnForAgents: z.ZodBoolean;
        addressCheck: z.ZodEnum<["physical", "digital"]>;
        selfieTries: z.ZodNumber;
        reviewTargetHours: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        mode: "manual" | "provider";
        provider: string | null;
        customerIdTypes: ("nin" | "bvn" | "drivers_licence" | "voters_card" | "passport")[];
        agentIdTypes: ("nin" | "bvn" | "drivers_licence" | "voters_card" | "passport")[];
        requireBvnForAgents: boolean;
        addressCheck: "physical" | "digital";
        selfieTries: number;
        reviewTargetHours: number;
    }, {
        mode: "manual" | "provider";
        provider: string | null;
        customerIdTypes: ("nin" | "bvn" | "drivers_licence" | "voters_card" | "passport")[];
        agentIdTypes: ("nin" | "bvn" | "drivers_licence" | "voters_card" | "passport")[];
        requireBvnForAgents: boolean;
        addressCheck: "physical" | "digital";
        selfieTries: number;
        reviewTargetHours: number;
    }>;
    profiles: z.ZodObject<{
        showCustomerPhotoBeforeAccept: z.ZodBoolean;
    }, "strip", z.ZodTypeAny, {
        showCustomerPhotoBeforeAccept: boolean;
    }, {
        showCustomerPhotoBeforeAccept: boolean;
    }>;
}, "strip", z.ZodTypeAny, {
    pricing: {
        baseFeeKobo: number;
        ratePerKmKobo: number;
        minFeeKobo: number;
    };
    fees: {
        serviceFeeBps: number;
        serviceFeeMinKobo: number;
        serviceFeeCapKobo: number;
        commissionBps: {
            bronze: number;
            silver: number;
            gold: number;
            platinum: number;
        };
        launchCommissionBps: number | null;
        instantWithdrawalFeeKobo: number;
    };
    timers: {
        urgentWidenMinutes: number;
        raisePricePromptMinutes: number;
        urgentExpiryMinutes: number;
        boardRaisePromptMinutes: number;
        itemLockMinutes: number;
        dropoffWaitMinutes: number;
        autoReleaseHours: number;
        unreachableHours: number;
        disputeResponseHours: number;
        disputeDecisionHours: number;
        bronzePayoutHoldHours: number;
    };
    limits: {
        newCustomerItemLimitKobo: number;
        newAgentItemLimitKobo: number;
        newAgentDailyWithdrawalKobo: number;
        strikeThreshold: number;
        pinAttempts: number;
        otpAttempts: number;
        otpPerHour: number;
        otpResendSeconds: number;
        otpTtlSeconds: number;
    };
    identity: {
        mode: "manual" | "provider";
        provider: string | null;
        customerIdTypes: ("nin" | "bvn" | "drivers_licence" | "voters_card" | "passport")[];
        agentIdTypes: ("nin" | "bvn" | "drivers_licence" | "voters_card" | "passport")[];
        requireBvnForAgents: boolean;
        addressCheck: "physical" | "digital";
        selfieTries: number;
        reviewTargetHours: number;
    };
    profiles: {
        showCustomerPhotoBeforeAccept: boolean;
    };
}, {
    pricing: {
        baseFeeKobo: number;
        ratePerKmKobo: number;
        minFeeKobo: number;
    };
    fees: {
        serviceFeeBps: number;
        serviceFeeMinKobo: number;
        serviceFeeCapKobo: number;
        commissionBps: {
            bronze: number;
            silver: number;
            gold: number;
            platinum: number;
        };
        launchCommissionBps: number | null;
        instantWithdrawalFeeKobo: number;
    };
    timers: {
        urgentWidenMinutes: number;
        raisePricePromptMinutes: number;
        urgentExpiryMinutes: number;
        boardRaisePromptMinutes: number;
        itemLockMinutes: number;
        dropoffWaitMinutes: number;
        autoReleaseHours: number;
        unreachableHours: number;
        disputeResponseHours: number;
        disputeDecisionHours: number;
        bronzePayoutHoldHours: number;
    };
    limits: {
        newCustomerItemLimitKobo: number;
        newAgentItemLimitKobo: number;
        newAgentDailyWithdrawalKobo: number;
        strikeThreshold: number;
        pinAttempts: number;
        otpAttempts: number;
        otpPerHour: number;
        otpResendSeconds: number;
        otpTtlSeconds: number;
    };
    identity: {
        mode: "manual" | "provider";
        provider: string | null;
        customerIdTypes: ("nin" | "bvn" | "drivers_licence" | "voters_card" | "passport")[];
        agentIdTypes: ("nin" | "bvn" | "drivers_licence" | "voters_card" | "passport")[];
        requireBvnForAgents: boolean;
        addressCheck: "physical" | "digital";
        selfieTries: number;
        reviewTargetHours: number;
    };
    profiles: {
        showCustomerPhotoBeforeAccept: boolean;
    };
}>;
export type CountrySettings = z.infer<typeof CountrySettingsSchema>;
/**
 * Nigeria's starting values. The spec leaves the percentages and amounts to admin before launch;
 * these are the sample figures the prototypes use, to be replaced in admin.
 */
export declare const NIGERIA_DEFAULT_SETTINGS: CountrySettings;
/** The part of the settings the apps may read. Limits and identity provider details stay on the server. */
export declare function publicSettings(s: CountrySettings): {
    pricing: {
        baseFeeKobo: number;
        ratePerKmKobo: number;
        minFeeKobo: number;
    };
    fees: {
        serviceFeeBps: number;
        serviceFeeMinKobo: number;
        serviceFeeCapKobo: number;
    };
    timers: {
        urgentWidenMinutes: number;
        raisePricePromptMinutes: number;
        urgentExpiryMinutes: number;
        boardRaisePromptMinutes: number;
        itemLockMinutes: number;
        dropoffWaitMinutes: number;
        autoReleaseHours: number;
        unreachableHours: number;
        disputeResponseHours: number;
        disputeDecisionHours: number;
        bronzePayoutHoldHours: number;
    };
    identity: {
        mode: "manual" | "provider";
        customerIdTypes: ("nin" | "bvn" | "drivers_licence" | "voters_card" | "passport")[];
        agentIdTypes: ("nin" | "bvn" | "drivers_licence" | "voters_card" | "passport")[];
    };
};
export type PublicSettings = ReturnType<typeof publicSettings>;
