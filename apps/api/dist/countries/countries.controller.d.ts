import { CountriesService } from './countries.service';
export declare class CountriesController {
    private readonly countries;
    constructor(countries: CountriesService);
    /** Everything the apps need at start-up for one country. Public: the apps call it before sign-in. */
    config(code: string): Promise<{
        country: {
            code: string;
            name: string;
            currency: string;
            phonePrefix: string;
            timezone: string;
        };
        settingsVersion: number;
        settings: {
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
        states: {
            code: string;
            name: string;
            agentSignups: "open" | "waitlist";
        }[];
        categories: {
            key: string;
            name: string;
            icon: string;
            description: string;
            buyDefault: boolean;
        }[];
    }>;
}
