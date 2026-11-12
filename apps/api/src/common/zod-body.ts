import { PipeTransform } from '@nestjs/common';
import type { ZodType, ZodTypeDef } from 'zod';
import { badRequest } from './errors';

/** Validates and parses a request body (or query) with a zod schema: @Body(new ZodBody(Schema)). */
export class ZodBody<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T, ZodTypeDef, unknown>) {}

  transform(value: unknown): T {
    const parsed = this.schema.safeParse(value);
    if (!parsed.success) {
      throw badRequest('invalid_request', 'The request is not valid', {
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    return parsed.data;
  }
}
