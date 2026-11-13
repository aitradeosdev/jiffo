import { eq } from 'drizzle-orm';
import type { Db, Tx } from '../db/database.module';
import { countries } from '../db/schema';
import { notFound } from '../common/errors';

/** The country an admin request is about, or 404 for one Jiffo doesn't know. */
export async function requireCountry(db: Db | Tx, code: string) {
  const [country] = await db.select().from(countries).where(eq(countries.code, code));
  if (!country) throw notFound('country_not_found', 'Country not found');
  return country;
}
