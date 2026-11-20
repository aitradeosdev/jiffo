import { ArgumentMetadata, PipeTransform } from '@nestjs/common';
import { safeParse, type ZodType } from 'zod';
import type { $ZodType } from 'zod/v4/core';
import { badRequest } from './errors';

type Path = Array<string | number>;
const isPlain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** A schema's definition, as zod keeps it: its type, and what it wraps or holds. */
interface Def {
  type: string;
  innerType?: $ZodType;
  in?: $ZodType;
  out?: $ZodType;
  getter?: () => $ZodType;
  element?: $ZodType;
  items?: $ZodType[];
  rest?: $ZodType | null;
  valueType?: $ZodType;
  shape?: Record<string, $ZodType>;
  catchall?: $ZodType;
  options?: $ZodType[];
  left?: $ZodType;
  right?: $ZodType;
}
const defOf = (schema: $ZodType) => schema._zod.def as unknown as Def;

/**
 * The fields in `value`, at any depth, that `schema` doesn't take. An object schema takes only its own keys
 * unless it says otherwise with .passthrough() (a provider's webhook, say) or .catchall(); optionals,
 * defaults, pipes, unions, arrays and records are looked through to the objects inside.
 */
export function unknownFields(schema: $ZodType, value: unknown, path: Path = []): string[] {
  const def = defOf(schema);
  switch (def.type) {
    case 'optional':
    case 'nullable':
      return value == null ? [] : unknownFields(def.innerType!, value, path);
    case 'default':
    case 'prefault':
      return value === undefined ? [] : unknownFields(def.innerType!, value, path);
    case 'catch':
    case 'readonly':
    case 'nonoptional':
      return unknownFields(def.innerType!, value, path);
    case 'pipe':
      // A transform's input is what was sent; a preprocess (a transform first) hands its output on.
      return unknownFields(defOf(def.in!).type === 'transform' ? def.out! : def.in!, value, path);
    case 'lazy':
      return unknownFields(def.getter!(), value, path);
    case 'array':
      return Array.isArray(value) ? value.flatMap((v, i) => unknownFields(def.element!, v, [...path, i])) : [];
    case 'tuple':
      return Array.isArray(value)
        ? value.flatMap((v, i) => {
            const item = def.items![i] ?? def.rest ?? null;
            return item ? unknownFields(item, v, [...path, i]) : [];
          })
        : [];
    case 'record':
      return isPlain(value)
        ? Object.entries(value).flatMap(([k, v]) => unknownFields(def.valueType!, v, [...path, k]))
        : [];
    case 'object': {
      if (!isPlain(value)) return [];
      const shape = def.shape!;
      // No catchall: unknown keys would be stripped, so they are refused here. .passthrough() takes anything.
      const catchall = def.catchall;
      return Object.entries(value).flatMap(([k, v]) => {
        if (Object.prototype.hasOwnProperty.call(shape, k)) return unknownFields(shape[k]!, v, [...path, k]);
        if (catchall && defOf(catchall).type !== 'never') return unknownFields(catchall, v, [...path, k]);
        return [[...path, k].join('.')];
      });
    }
    case 'union': {
      // Checked against the option the value fits; one that fits none is refused by parsing anyway.
      const option = def.options!.find((o) => safeParse(o, value).success);
      return option ? unknownFields(option, value, path) : [];
    }
    case 'intersection': {
      // A field is unknown only if neither side takes it.
      const right = new Set(unknownFields(def.right!, value, path));
      return unknownFields(def.left!, value, path).filter((f) => right.has(f));
    }
    default:
      return [];
  }
}

/** Refuses a value with fields its schema doesn't take (docs/security-plan.md, R3). */
export function refuseUnknownFields(schema: $ZodType, value: unknown, prefix: Path = []) {
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
  constructor(readonly schema: ZodType<T, unknown>) {}

  transform(value: unknown, metadata?: ArgumentMetadata): T {
    if (metadata?.type === 'body') refuseUnknownFields(this.schema, value);
    const parsed = this.schema.safeParse(value);
    if (!parsed.success) {
      throw badRequest('invalid_request', 'The request is not valid', {
        issues: parsed.error.issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message })),
      });
    }
    return parsed.data;
  }
}
