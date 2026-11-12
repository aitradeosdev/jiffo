"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NIGERIA_DEFAULT_SETTINGS = exports.CountrySettingsSchema = exports.AGENT_TIERS = void 0;
exports.publicSettings = publicSettings;
const zod_1 = require("zod");
const identity_1 = require("./identity");
const kobo = zod_1.z.number().int().nonnegative();
const bps = zod_1.z.number().int().min(0).max(10_000);
const minutes = zod_1.z.number().int().positive();
exports.AGENT_TIERS = ['bronze', 'silver', 'gold', 'platinum'];
/**
 * Everything admin can change for a country. Each saved change becomes a new version,
 * so an errand can always be explained by the settings that applied when it ran.
 */
exports.CountrySettingsSchema = zod_1.z.object({
    pricing: zod_1.z.object({
        baseFeeKobo: kobo,
        ratePerKmKobo: kobo,
        minFeeKobo: kobo,
    }),
    fees: zod_1.z
        .object({
        serviceFeeBps: bps,
        serviceFeeMinKobo: kobo,
        serviceFeeCapKobo: kobo,
        commissionBps: zod_1.z.object({ bronze: bps, silver: bps, gold: bps, platinum: bps }),
        launchCommissionBps: bps.nullable(),
        instantWithdrawalFeeKobo: kobo,
    })
        .refine((f) => f.serviceFeeMinKobo <= f.serviceFeeCapKobo, 'The service fee minimum must not exceed the cap'),
    timers: zod_1.z.object({
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
    }),
    limits: zod_1.z.object({
        newCustomerItemLimitKobo: kobo,
        newAgentItemLimitKobo: kobo,
        newAgentDailyWithdrawalKobo: kobo,
        strikeThreshold: zod_1.z.number().int().positive(),
        pinAttempts: zod_1.z.number().int().positive(),
        otpAttempts: zod_1.z.number().int().positive(),
        otpPerHour: zod_1.z.number().int().positive(),
        otpResendSeconds: zod_1.z.number().int().positive(),
        otpTtlSeconds: zod_1.z.number().int().positive(),
    }),
    identity: zod_1.z.object({
        mode: zod_1.z.enum(['manual', 'provider']),
        provider: zod_1.z.string().min(1).nullable(),
        customerIdTypes: zod_1.z.array(zod_1.z.enum(identity_1.ID_TYPE_KEYS)).min(1),
        agentIdTypes: zod_1.z.array(zod_1.z.enum(identity_1.ID_TYPE_KEYS)).min(1),
        requireBvnForAgents: zod_1.z.boolean(),
        addressCheck: zod_1.z.enum(['physical', 'digital']),
        selfieTries: zod_1.z.number().int().positive(),
        reviewTargetHours: zod_1.z.number().int().positive(),
    }),
    profiles: zod_1.z.object({
        showCustomerPhotoBeforeAccept: zod_1.z.boolean(),
    }),
});
/**
 * Nigeria's starting values. The spec leaves the percentages and amounts to admin before launch;
 * these are the sample figures the prototypes use, to be replaced in admin.
 */
exports.NIGERIA_DEFAULT_SETTINGS = {
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
function publicSettings(s) {
    return {
        pricing: s.pricing,
        fees: {
            serviceFeeBps: s.fees.serviceFeeBps,
            serviceFeeMinKobo: s.fees.serviceFeeMinKobo,
            serviceFeeCapKobo: s.fees.serviceFeeCapKobo,
        },
        timers: s.timers,
        identity: {
            mode: s.identity.mode,
            customerIdTypes: s.identity.customerIdTypes,
            agentIdTypes: s.identity.agentIdTypes,
        },
    };
}
//# sourceMappingURL=settings.js.map