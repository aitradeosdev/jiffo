ALTER TABLE "deposits" ADD COLUMN "request_key" text;--> statement-breakpoint
ALTER TABLE "fixed_accounts" ADD COLUMN "failures" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "fixed_accounts" ADD COLUMN "last_failure_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "deposits_request_key_uq" ON "deposits" USING btree ("user_id","request_key");