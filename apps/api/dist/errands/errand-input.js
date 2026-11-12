"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ListQuery = exports.BoardQuery = exports.ErrandEventBody = exports.EVENT_DATA = exports.CreateErrandBody = void 0;
const zod_1 = require("zod");
const Kobo = zod_1.z.number().int().positive().max(100_000_000_000);
const StorageKey = zod_1.z.string().min(1).max(300);
const Stop = zod_1.z.object({
    kind: zod_1.z.enum(['pickup', 'stop', 'dropoff']),
    label: zod_1.z.string().trim().max(60).optional(),
    address: zod_1.z.string().trim().min(3).max(300),
    lat: zod_1.z.number().min(-90).max(90),
    lng: zod_1.z.number().min(-180).max(180),
});
exports.CreateErrandBody = zod_1.z
    .object({
    categoryKey: zod_1.z.string().min(1).max(40),
    stateCode: zod_1.z.string().min(1).max(10),
    description: zod_1.z.string().trim().min(3).max(1000),
    /** Leave out to use the category's default. */
    buy: zod_1.z.boolean().optional(),
    urgent: zod_1.z.boolean().default(false),
    scheduledFor: zod_1.z.coerce.date().optional(),
    feeKobo: Kobo,
    stops: zod_1.z.array(Stop).min(2).max(10),
})
    .superRefine((b, ctx) => {
    const kinds = b.stops.map((s) => s.kind);
    const middleOk = kinds.slice(1, -1).every((k) => k === 'stop');
    if (kinds[0] !== 'pickup' || kinds[kinds.length - 1] !== 'dropoff' || !middleOk) {
        ctx.addIssue({
            code: zod_1.z.ZodIssueCode.custom,
            path: ['stops'],
            message: 'Start with one pickup, end with one drop-off, and put any extra stops in between',
        });
    }
    if (b.urgent && b.scheduledFor) {
        ctx.addIssue({
            code: zod_1.z.ZodIssueCode.custom,
            path: ['scheduledFor'],
            message: 'An urgent errand cannot be scheduled',
        });
    }
});
/** What each event needs from the caller. Events not listed take no data. */
exports.EVENT_DATA = {
    cancel: zod_1.z.object({ reason: zod_1.z.string().trim().max(300).optional() }),
    send_offer: zod_1.z.object({ amountKobo: Kobo }),
    send_item_amount: zod_1.z.object({ amountKobo: Kobo, photos: zod_1.z.array(StorageKey).min(1).max(6) }),
    confirm_pin: zod_1.z.object({ pin: zod_1.z.string().regex(/^\d{4}$/, 'The PIN is 4 digits') }),
    send_dropoff_photo: zod_1.z.object({ photo: StorageKey, note: zod_1.z.string().trim().max(300).optional() }),
    report_unreachable: zod_1.z.object({ note: zod_1.z.string().trim().max(300).optional() }),
    open_dispute: zod_1.z.object({ reason: zod_1.z.string().trim().min(3).max(500) }),
};
exports.ErrandEventBody = zod_1.z.object({
    event: zod_1.z.string().min(1).max(40),
    /** The errand version the app was showing. If the errand changed since, the event is refused. */
    version: zod_1.z.number().int().nonnegative().optional(),
    data: zod_1.z.record(zod_1.z.unknown()).default({}),
});
exports.BoardQuery = zod_1.z.object({
    lat: zod_1.z.coerce.number().min(-90).max(90),
    lng: zod_1.z.coerce.number().min(-180).max(180),
    radiusKm: zod_1.z.coerce.number().positive().max(50).default(10),
    limit: zod_1.z.coerce.number().int().min(1).max(100).default(50),
});
exports.ListQuery = zod_1.z.object({
    before: zod_1.z.coerce.date().optional(),
    limit: zod_1.z.coerce.number().int().min(1).max(100).default(20),
});
//# sourceMappingURL=errand-input.js.map