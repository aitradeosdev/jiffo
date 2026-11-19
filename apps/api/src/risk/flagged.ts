import { sql, type SQL } from 'drizzle-orm';

/**
 * An errand flagged for fraud that no reviewer has cleared (docs/security-plan.md, F3): open or confirmed. The
 * counts admin sets agent tiers by leave these out. `errandId` is the errand's id column as SQL, qualified.
 */
export const flaggedErrand = (errandId: SQL) =>
  sql<boolean>`exists (select 1 from risk_flag_errands fe join risk_flags f on f.id = fe.flag_id
    where fe.errand_id = ${errandId} and f.status <> 'cleared')`;
