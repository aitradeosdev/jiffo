CREATE TABLE IF NOT EXISTS "risk_flag_errands" (
	"flag_id" uuid NOT NULL,
	"errand_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "risk_flag_errands_flag_id_errand_id_pk" PRIMARY KEY("flag_id","errand_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "risk_flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"country_code" char(2) NOT NULL,
	"queue" text NOT NULL,
	"kind" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"user_id" uuid NOT NULL,
	"other_user_id" uuid,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "phone_fingerprint" text;--> statement-breakpoint
ALTER TABLE "payout_accounts" ADD COLUMN "account_fingerprint" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "risk_flag_errands" ADD CONSTRAINT "risk_flag_errands_flag_id_risk_flags_id_fk" FOREIGN KEY ("flag_id") REFERENCES "public"."risk_flags"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "risk_flag_errands" ADD CONSTRAINT "risk_flag_errands_errand_id_errands_id_fk" FOREIGN KEY ("errand_id") REFERENCES "public"."errands"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "risk_flags" ADD CONSTRAINT "risk_flags_country_code_countries_code_fk" FOREIGN KEY ("country_code") REFERENCES "public"."countries"("code") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "risk_flags" ADD CONSTRAINT "risk_flags_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "risk_flags" ADD CONSTRAINT "risk_flags_other_user_id_users_id_fk" FOREIGN KEY ("other_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "risk_flags" ADD CONSTRAINT "risk_flags_decided_by_admins_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "risk_flag_errands_errand_idx" ON "risk_flag_errands" USING btree ("errand_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "risk_flags_dedupe_uq" ON "risk_flags" USING btree ("kind","dedupe_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "risk_flags_queue_idx" ON "risk_flags" USING btree ("country_code","queue","status","created_at","id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "risk_flags_user_idx" ON "risk_flags" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "risk_flags_other_user_idx" ON "risk_flags" USING btree ("other_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "devices_key_idx" ON "devices" USING btree ("device_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "devices_phone_fingerprint_idx" ON "devices" USING btree ("phone_fingerprint");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "devices_public_key_idx" ON "devices" USING btree ("public_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payout_accounts_fingerprint_idx" ON "payout_accounts" USING btree ("account_fingerprint");