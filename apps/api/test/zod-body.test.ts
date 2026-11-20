import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { unknownFields } from '../src/common/zod-body';

/**
 * Refusing fields a request doesn't take, at any depth (docs/security-plan.md, R3): every kind of schema the
 * check looks through. If a zod upgrade changes how schemas are kept, these fail rather than the check
 * quietly letting fields through.
 */
describe('unknown fields', () => {
  const item = z.object({ name: z.string() });

  it('finds them in objects, nested ones too', () => {
    const s = z.object({ a: z.string(), inner: item });
    expect(unknownFields(s, { a: 'x', status: 'paid', inner: { name: 'y', role: 'admin' } })).toEqual([
      'status',
      'inner.role',
    ]);
    expect(unknownFields(s, { a: 'x', inner: { name: 'y' } })).toEqual([]);
  });

  it('lets a passthrough object or a catchall take any key, checking a catchall object inside', () => {
    expect(unknownFields(z.object({ a: z.string() }).passthrough(), { a: 'x', extra: 1 })).toEqual([]);
    expect(unknownFields(z.object({}).catchall(item), { k: { name: 'x', role: 1 } })).toEqual(['k.role']);
    expect(unknownFields(z.object({ a: z.string() }).strict(), { a: 'x', extra: 1 })).toEqual(['extra']);
  });

  it('looks through optional, nullable, default, catch, readonly and refinements', () => {
    for (const s of [
      item.optional(),
      item.nullable(),
      item.default({ name: 'd' }),
      item.catch({ name: 'c' }),
      item.readonly(),
      item.refine(() => true),
      item.superRefine(() => undefined),
    ]) {
      expect(unknownFields(s, { name: 'x', role: 1 })).toEqual(['role']);
    }
    expect(unknownFields(item.optional(), undefined)).toEqual([]);
  });

  it("checks a transform's input and a preprocess's output", () => {
    expect(
      unknownFields(
        item.transform((v) => v.name),
        { name: 'x', role: 1 },
      ),
    ).toEqual(['role']);
    expect(
      unknownFields(
        z.preprocess((v) => v, item),
        { name: 'x', role: 1 },
      ),
    ).toEqual(['role']);
    expect(unknownFields(item.pipe(z.object({ name: z.string() })), { name: 'x', role: 1 })).toEqual(['role']);
  });

  it('looks into arrays, tuples, records and lazy schemas', () => {
    expect(unknownFields(z.array(item), [{ name: 'a' }, { name: 'b', role: 1 }])).toEqual(['1.role']);
    expect(unknownFields(z.tuple([z.string(), item]), ['x', { name: 'y', role: 1 }])).toEqual(['1.role']);
    expect(unknownFields(z.record(z.string(), item), { k: { name: 'y', role: 1 } })).toEqual(['k.role']);
    expect(
      unknownFields(
        z.lazy(() => item),
        { name: 'x', role: 1 },
      ),
    ).toEqual(['role']);
  });

  it('checks a union against the option the value fits, and an intersection against both sides', () => {
    const union = z.union([z.object({ kind: z.literal('a'), a: z.string() }), z.object({ kind: z.literal('b') })]);
    expect(unknownFields(union, { kind: 'a', a: 'x', role: 1 })).toEqual(['role']);
    const tagged = z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('a'), a: z.string() }),
      z.object({ kind: z.literal('b'), b: z.number() }),
    ]);
    expect(unknownFields(tagged, { kind: 'b', b: 1, role: 1 })).toEqual(['role']);
    const both = z.intersection(z.object({ a: z.string() }), z.object({ b: z.string() }));
    expect(unknownFields(both, { a: 'x', b: 'y', role: 1 })).toEqual(['role']);
  });
});
