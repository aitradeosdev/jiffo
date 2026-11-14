import { ArgumentMetadata, PipeTransform } from '@nestjs/common';
import {
  ZodArray,
  ZodBranded,
  ZodCatch,
  ZodDefault,
  ZodDiscriminatedUnion,
  ZodEffects,
  ZodIntersection,
  ZodLazy,
  ZodNever,
  ZodNullable,
  ZodObject,
  ZodOptional,
  ZodPipeline,
  ZodReadonly,
  ZodRecord,
  ZodTuple,
  ZodUnion,
  type ZodTypeAny,
  type ZodType,
  type ZodTypeDef,
} from 'zod';
import { badRequest } from './errors';

type Path = Array<string | number>;
const isPlain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * The fields in `value`, at any depth, that `schema` doesn't take. An object schema takes only its own keys
 * unless it says otherwise with .passthrough() (a provider's webhook, say) or .catchall(); refinements,
 * optionals, defaults, pipes, unions, arrays and records are looked through to the objects inside.
 */
export function unknownFields(schema: ZodTypeAny, value: unknown, path: Path = []): string[] {
  if (schema instanceof ZodEffects) return unknownFields(schema.innerType(), value, path);
  if (schema instanceof ZodOptional || schema instanceof ZodNullable) {
    return value == null ? [] : unknownFields(schema.unwrap(), value, path);
  }
  if (schema instanceof ZodDefault)
    return value === undefined ? [] : unknownFields(schema.removeDefault(), value, path);
  if (schema instanceof ZodCatch) return unknownFields(schema.removeCatch(), value, path);
  if (schema instanceof ZodBranded) return unknownFields(schema.unwrap(), value, path);
  if (schema instanceof ZodReadonly) return unknownFields(schema._def.innerType, value, path);
  if (schema instanceof ZodPipeline) return unknownFields(schema._def.in, value, path);
  if (schema instanceof ZodLazy) return unknownFields(schema.schema, value, path);
  if (schema instanceof ZodArray) {
    return Array.isArray(value) ? value.flatMap((v, i) => unknownFields(schema.element, v, [...path, i])) : [];
  }
  if (schema instanceof ZodTuple) {
    const items = schema.items as ZodTypeAny[];
    return Array.isArray(value)
      ? value.flatMap((v, i) => {
          const item = items[i] ?? (schema._def.rest as ZodTypeAny | null);
          return item ? unknownFields(item, v, [...path, i]) : [];
        })
      : [];
  }
  if (schema instanceof ZodRecord) {
    return isPlain(value)
      ? Object.entries(value).flatMap(([k, v]) => unknownFields(schema.valueSchema, v, [...path, k]))
      : [];
  }
  if (schema instanceof ZodObject) {
    if (!isPlain(value)) return [];
    const shape = schema.shape as Record<string, ZodTypeAny>;
    const catchall = schema._def.catchall as ZodTypeAny;
    const open = schema._def.unknownKeys === 'passthrough';
    return Object.entries(value).flatMap(([k, v]) => {
      if (Object.prototype.hasOwnProperty.call(shape, k)) return unknownFields(shape[k]!, v, [...path, k]);
      if (!(catchall instanceof ZodNever)) return unknownFields(catchall, v, [...path, k]);
      return open ? [] : [[...path, k].join('.')];
    });
  }
  if (schema instanceof ZodDiscriminatedUnion) {
    const option = isPlain(value) ? schema.optionsMap.get(value[schema.discriminator] as never) : undefined;
    return option ? unknownFields(option, value, path) : [];
  }
  if (schema instanceof ZodUnion) {
    // Checked against the option the value fits; one that fits none is refused by parsing anyway.
    const option = (schema.options as ZodTypeAny[]).find((o) => o.safeParse(value).success);
    return option ? unknownFields(option, value, path) : [];
  }
  if (schema instanceof ZodIntersection) {
    // A field is unknown only if neither side takes it.
    const right = new Set(unknownFields(schema._def.right, value, path));
    return unknownFields(schema._def.left, value, path).filter((f) => right.has(f));
  }
  return [];
}

/** Refuses a value with fields its schema doesn't take (docs/security-plan.md, R3). */
export function refuseUnknownFields(schema: ZodTypeAny, value: unknown, prefix: Path = []) {
  const unknown = unknownFields(schema, value, prefix);
  if (unknown.length) {
    throw badRequest('invalid_request', 'The request is not valid', {
      issues: unknown.map((path) => ({ path, message: 'Not a field this request takes' })),
    });
  }
}

/**
 * Validates and parses a request body (or query) with a zod schema: @Body(new ZodBody(Schema)). A body with
 * a field the endpoint doesn't take, at any depth, is refused rather than quietly stripped, so a client can
 * never set a status, amount or role by adding it. Queries keep ignoring extra parameters.
 */
export class ZodBody<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T, ZodTypeDef, unknown>) {}

  transform(value: unknown, metadata?: ArgumentMetadata): T {
    if (metadata?.type === 'body') refuseUnknownFields(this.schema, value);
    const parsed = this.schema.safeParse(value);
    if (!parsed.success) {
      throw badRequest('invalid_request', 'The request is not valid', {
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    return parsed.data;
  }
}
