import { z } from 'zod';

const Kobo = z.number().int().positive().max(100_000_000_000);
const StorageKey = z.string().min(1).max(300);

const Stop = z.object({
  kind: z.enum(['pickup', 'stop', 'dropoff']),
  label: z.string().trim().max(60).optional(),
  address: z.string().trim().min(3).max(300),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export const CreateErrandBody = z
  .object({
    categoryKey: z.string().min(1).max(40),
    stateCode: z.string().min(1).max(10),
    description: z.string().trim().min(3).max(1000),
    /** Leave out to use the category's default. */
    buy: z.boolean().optional(),
    urgent: z.boolean().default(false),
    scheduledFor: z.coerce.date().optional(),
    feeKobo: Kobo,
    stops: z.array(Stop).min(2).max(10),
  })
  .superRefine((b, ctx) => {
    const kinds = b.stops.map((s) => s.kind);
    const middleOk = kinds.slice(1, -1).every((k) => k === 'stop');
    if (kinds[0] !== 'pickup' || kinds[kinds.length - 1] !== 'dropoff' || !middleOk) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['stops'],
        message: 'Start with one pickup, end with one drop-off, and put any extra stops in between',
      });
    }
    if (b.urgent && b.scheduledFor) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['scheduledFor'],
        message: 'An urgent errand cannot be scheduled',
      });
    }
  });
export type CreateErrandInput = z.infer<typeof CreateErrandBody>;

/** What each event needs from the caller. Events not listed take no data. */
export const EVENT_DATA = {
  cancel: z.object({ reason: z.string().trim().max(300).optional() }),
  send_offer: z.object({ amountKobo: Kobo }),
  send_item_amount: z.object({ amountKobo: Kobo, photos: z.array(StorageKey).min(1).max(6) }),
  confirm_pin: z.object({ pin: z.string().regex(/^\d{4}$/, 'The PIN is 4 digits') }),
  send_dropoff_photo: z.object({ photo: StorageKey, note: z.string().trim().max(300).optional() }),
  report_unreachable: z.object({ note: z.string().trim().max(300).optional() }),
  open_dispute: z.object({ reason: z.string().trim().min(3).max(500) }),
} as const;

export const ErrandEventBody = z.object({
  event: z.string().min(1).max(40),
  /** The errand version the app was showing. If the errand changed since, the event is refused. */
  version: z.number().int().nonnegative().optional(),
  data: z.record(z.unknown()).default({}),
});
export type ErrandEventInput = z.infer<typeof ErrandEventBody>;

export const QuoteBody = z.object({
  stops: z
    .array(z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }))
    .min(2)
    .max(10),
});

export const BoardQuery = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  radiusKm: z.coerce.number().positive().max(50).default(10),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const ListQuery = z.object({
  before: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
