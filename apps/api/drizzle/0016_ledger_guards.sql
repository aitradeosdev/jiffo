ALTER TABLE "ledger_accounts" DROP CONSTRAINT "ledger_accounts_balance_ck";--> statement-breakpoint
ALTER TABLE "ledger_accounts" DROP COLUMN IF EXISTS "allow_negative";--> statement-breakpoint
-- Added unchecked, then checked: the check reads every row without holding the table's exclusive lock.
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_balance_ck" CHECK ("ledger_accounts"."owner_id" is null or "ledger_accounts"."balance" >= 0) NOT VALID;--> statement-breakpoint
ALTER TABLE "ledger_accounts" VALIDATE CONSTRAINT "ledger_accounts_balance_ck";--> statement-breakpoint
-- The ledger is append-only (docs/security-plan.md, L3): a mistake is put right with a reversing entry.
CREATE OR REPLACE FUNCTION ledger_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'The ledger is append-only: % on % is not allowed. Post a reversing entry instead.', TG_OP, TG_TABLE_NAME;
END
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS journal_entries_append_only ON journal_entries;--> statement-breakpoint
CREATE TRIGGER journal_entries_append_only BEFORE UPDATE OR DELETE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION ledger_append_only();--> statement-breakpoint
DROP TRIGGER IF EXISTS journal_entries_no_truncate ON journal_entries;--> statement-breakpoint
CREATE TRIGGER journal_entries_no_truncate BEFORE TRUNCATE ON journal_entries
  FOR EACH STATEMENT EXECUTE FUNCTION ledger_append_only();--> statement-breakpoint
DROP TRIGGER IF EXISTS postings_append_only ON postings;--> statement-breakpoint
CREATE TRIGGER postings_append_only BEFORE UPDATE OR DELETE ON postings
  FOR EACH ROW EXECUTE FUNCTION ledger_append_only();--> statement-breakpoint
DROP TRIGGER IF EXISTS postings_no_truncate ON postings;--> statement-breakpoint
CREATE TRIGGER postings_no_truncate BEFORE TRUNCATE ON postings
  FOR EACH STATEMENT EXECUTE FUNCTION ledger_append_only();
