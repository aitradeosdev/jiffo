import { ArgumentMetadata, PipeTransform } from '@nestjs/common';
import { ZodEffects, ZodObject, type ZodType, type ZodTypeDef } from 'zod';
import { badRequest } from './errors';

/** The fields an object schema takes, looking through refinements; null for any other schema. */
function knownKeys(schema: ZodType): Set<string> | null {
  let inner: ZodType = schema;
  while (inner instanceof ZodEffects) inner = inner.innerType();
  return inner instanceof ZodObject ? new Set(Object.keys(inner.shape as object)) : null;
}

/**
 * Validates and parses a request body (or query) with a zod schema: @Body(new ZodBody(Schema)). A body with
 * a field the endpoint doesn't take is refused, not quietly stripped (docs/security-plan.md, R3), so a
 * client can never set a status, amount or role by adding it. Queries keep ignoring extra parameters.
 */
export class ZodBody<T> implements PipeTransform<unknown, T> {
  private readonly keys: Set<string> | null;

  constructor(private readonly schema: ZodType<T, ZodTypeDef, unknown>) {
    this.keys = knownKeys(schema);
  }

  transform(value: unknown, metadata?: ArgumentMetadata): T {
    if (metadata?.type === 'body' && this.keys && value && typeof value === 'object' && !Array.isArray(value)) {
      const unknown = Object.keys(value).filter((key) => !this.keys!.has(key));
      if (unknown.length) {
        throw badRequest('invalid_request', 'The request is not valid', {
          issues: unknown.map((key) => ({ path: key, message: 'Not a field this request takes' })),
        });
      }
    }
    const parsed = this.schema.safeParse(value);
    if (!parsed.success) {
      throw badRequest('invalid_request', 'The request is not valid', {
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    return parsed.data;
  }
}
