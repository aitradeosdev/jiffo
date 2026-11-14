ALTER TABLE "agent_applications" ADD COLUMN "legal_name_index" text[];--> statement-breakpoint
ALTER TABLE "customer_verifications" ADD COLUMN "legal_name_index" text[];--> statement-breakpoint
ALTER TABLE "payout_accounts" ADD COLUMN "account_last4" text;