import { PipeTransform } from '@nestjs/common';
import type { ZodType, ZodTypeDef } from 'zod';
/** Validates and parses a request body (or query) with a zod schema: @Body(new ZodBody(Schema)). */
export declare class ZodBody<T> implements PipeTransform<unknown, T> {
    private readonly schema;
    constructor(schema: ZodType<T, ZodTypeDef, unknown>);
    transform(value: unknown): T;
}
