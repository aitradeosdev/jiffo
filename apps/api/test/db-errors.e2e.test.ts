import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ApiExceptionFilter } from '../src/common/errors';
import { users } from '../src/db/schema';
import { createTestApp, randomPhone, type TestApp } from './helpers';

/**
 * Database errors (docs/security-plan.md, R10, S7): what a failed query says, which the logs
 * keep, names the database's reason and the query, never the values sent with it, which can be people's
 * phone numbers, names or places.
 */
describe('database errors', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  afterAll(() => t.close());

  /** A unique phone taken twice: the second insert fails. */
  const clash = async () => {
    const phone = randomPhone();
    await t.db.insert(users).values({ phone, countryCode: 'NG' });
    return {
      phone,
      error: (await t.db
        .insert(users)
        .values({ phone, countryCode: 'NG' })
        .catch((e: unknown) => e)) as Error,
    };
  };

  it("says the database's reason and the query, but not the values sent with it", async () => {
    const { phone, error } = await clash();
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toMatch(/duplicate key value violates unique constraint/);
    expect(error.message).toMatch(/insert into "users"/);
    expect(error.message).not.toContain(phone);
    expect(error.stack ?? '').not.toContain(phone);
  });

  it('keeps the values out of what the server logs for an unexpected error', async () => {
    const { phone, error } = await clash();
    const logged: string[] = [];
    vi.spyOn(Logger.prototype, 'error').mockImplementation((message: unknown) => {
      logged.push(String(message));
    });
    const res = { status: () => res, json: () => res };
    new ApiExceptionFilter().catch(error, {
      getType: () => 'http',
      switchToHttp: () => ({ getResponse: () => res }),
    } as never);
    expect(logged.join('\n')).toMatch(/duplicate key value/);
    expect(logged.join('\n')).not.toContain(phone);
  });

  it('says the same for a raw query', async () => {
    const secret = `secret-${randomUUID()}`;
    const error = (await t.db.execute(sql`select * from no_such_table where x = ${secret}`).catch((e) => e)) as Error;
    expect(error.message).toMatch(/relation "no_such_table" does not exist/);
    expect(error.message).not.toContain(secret);
  });
});
