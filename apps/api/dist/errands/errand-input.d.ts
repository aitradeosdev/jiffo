import { z } from 'zod';
export declare const CreateErrandBody: z.ZodEffects<z.ZodObject<{
    categoryKey: z.ZodString;
    stateCode: z.ZodString;
    description: z.ZodString;
    /** Leave out to use the category's default. */
    buy: z.ZodOptional<z.ZodBoolean>;
    urgent: z.ZodDefault<z.ZodBoolean>;
    scheduledFor: z.ZodOptional<z.ZodDate>;
    feeKobo: z.ZodNumber;
    stops: z.ZodArray<z.ZodObject<{
        kind: z.ZodEnum<["pickup", "stop", "dropoff"]>;
        label: z.ZodOptional<z.ZodString>;
        address: z.ZodString;
        lat: z.ZodNumber;
        lng: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        kind: "pickup" | "stop" | "dropoff";
        address: string;
        lat: number;
        lng: number;
        label?: string | undefined;
    }, {
        kind: "pickup" | "stop" | "dropoff";
        address: string;
        lat: number;
        lng: number;
        label?: string | undefined;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    description: string;
    stateCode: string;
    categoryKey: string;
    urgent: boolean;
    feeKobo: number;
    stops: {
        kind: "pickup" | "stop" | "dropoff";
        address: string;
        lat: number;
        lng: number;
        label?: string | undefined;
    }[];
    buy?: boolean | undefined;
    scheduledFor?: Date | undefined;
}, {
    description: string;
    stateCode: string;
    categoryKey: string;
    feeKobo: number;
    stops: {
        kind: "pickup" | "stop" | "dropoff";
        address: string;
        lat: number;
        lng: number;
        label?: string | undefined;
    }[];
    buy?: boolean | undefined;
    urgent?: boolean | undefined;
    scheduledFor?: Date | undefined;
}>, {
    description: string;
    stateCode: string;
    categoryKey: string;
    urgent: boolean;
    feeKobo: number;
    stops: {
        kind: "pickup" | "stop" | "dropoff";
        address: string;
        lat: number;
        lng: number;
        label?: string | undefined;
    }[];
    buy?: boolean | undefined;
    scheduledFor?: Date | undefined;
}, {
    description: string;
    stateCode: string;
    categoryKey: string;
    feeKobo: number;
    stops: {
        kind: "pickup" | "stop" | "dropoff";
        address: string;
        lat: number;
        lng: number;
        label?: string | undefined;
    }[];
    buy?: boolean | undefined;
    urgent?: boolean | undefined;
    scheduledFor?: Date | undefined;
}>;
export type CreateErrandInput = z.infer<typeof CreateErrandBody>;
/** What each event needs from the caller. Events not listed take no data. */
export declare const EVENT_DATA: {
    readonly cancel: z.ZodObject<{
        reason: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        reason?: string | undefined;
    }, {
        reason?: string | undefined;
    }>;
    readonly send_offer: z.ZodObject<{
        amountKobo: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        amountKobo: number;
    }, {
        amountKobo: number;
    }>;
    readonly send_item_amount: z.ZodObject<{
        amountKobo: z.ZodNumber;
        photos: z.ZodArray<z.ZodString, "many">;
    }, "strip", z.ZodTypeAny, {
        amountKobo: number;
        photos: string[];
    }, {
        amountKobo: number;
        photos: string[];
    }>;
    readonly confirm_pin: z.ZodObject<{
        pin: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        pin: string;
    }, {
        pin: string;
    }>;
    readonly send_dropoff_photo: z.ZodObject<{
        photo: z.ZodString;
        note: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        photo: string;
        note?: string | undefined;
    }, {
        photo: string;
        note?: string | undefined;
    }>;
    readonly report_unreachable: z.ZodObject<{
        note: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        note?: string | undefined;
    }, {
        note?: string | undefined;
    }>;
    readonly open_dispute: z.ZodObject<{
        reason: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        reason: string;
    }, {
        reason: string;
    }>;
};
export declare const ErrandEventBody: z.ZodObject<{
    event: z.ZodString;
    /** The errand version the app was showing. If the errand changed since, the event is refused. */
    version: z.ZodOptional<z.ZodNumber>;
    data: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, "strip", z.ZodTypeAny, {
    data: Record<string, unknown>;
    event: string;
    version?: number | undefined;
}, {
    event: string;
    data?: Record<string, unknown> | undefined;
    version?: number | undefined;
}>;
export type ErrandEventInput = z.infer<typeof ErrandEventBody>;
export declare const BoardQuery: z.ZodObject<{
    lat: z.ZodNumber;
    lng: z.ZodNumber;
    radiusKm: z.ZodDefault<z.ZodNumber>;
    limit: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    lat: number;
    lng: number;
    limit: number;
    radiusKm: number;
}, {
    lat: number;
    lng: number;
    limit?: number | undefined;
    radiusKm?: number | undefined;
}>;
export declare const ListQuery: z.ZodObject<{
    before: z.ZodOptional<z.ZodDate>;
    limit: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    limit: number;
    before?: Date | undefined;
}, {
    limit?: number | undefined;
    before?: Date | undefined;
}>;
