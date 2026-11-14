DROP INDEX IF EXISTS "payout_accounts_current_uq";--> statement-breakpoint
ALTER TABLE "payout_accounts" ADD COLUMN "review_status" text DEFAULT 'approved' NOT NULL;--> statement-breakpoint
ALTER TABLE "payout_accounts" ADD COLUMN "reviewed_by" uuid;--> statement-breakpoint
ALTER TABLE "payout_accounts" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payout_accounts" ADD COLUMN "review_note" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payout_accounts" ADD CONSTRAINT "payout_accounts_reviewed_by_admins_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payout_accounts_pending_uq" ON "payout_accounts" USING btree ("user_id") WHERE "payout_accounts"."replaced_at" is null and "payout_accounts"."review_status" = 'pending';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payout_accounts_review_idx" ON "payout_accounts" USING btree ("review_status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payout_accounts_current_uq" ON "payout_accounts" USING btree ("user_id") WHERE "payout_accounts"."replaced_at" is null and "payout_accounts"."review_status" = 'approved';