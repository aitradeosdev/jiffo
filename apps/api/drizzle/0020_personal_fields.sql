ALTER TABLE "agent_applications" ADD COLUMN "legal_name_index" text[];--> statement-breakpoint
ALTER TABLE "customer_verifications" ADD COLUMN "legal_name_index" text[];--> statement-breakpoint
ALTER TABLE "payout_accounts" ADD COLUMN "account_last4" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_applications_legal_name_ix" ON "agent_applications" USING gin ("legal_name_index");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "customer_verifications_legal_name_ix" ON "customer_verifications" USING gin ("legal_name_index");