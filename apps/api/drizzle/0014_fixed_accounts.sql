CREATE TABLE IF NOT EXISTS "fixed_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"country_code" char(2) NOT NULL,
	"provider" text NOT NULL,
	"owner_ref" text NOT NULL,
	"provider_ref" text,
	"status" text NOT NULL,
	"account_number" text,
	"account_name" text,
	"bank_name" text,
	"failure_reason" text,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"checking_until" timestamp with time zone,
	"issue_fee_kobo" bigint DEFAULT 0 NOT NULL,
	"activated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deposits" ALTER COLUMN "expires_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "deposits" ADD COLUMN "method" text DEFAULT 'one_time' NOT NULL;--> statement-breakpoint
ALTER TABLE "deposits" ADD COLUMN "fixed_account_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fixed_accounts" ADD CONSTRAINT "fixed_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fixed_accounts" ADD CONSTRAINT "fixed_accounts_country_code_countries_code_fk" FOREIGN KEY ("country_code") REFERENCES "public"."countries"("code") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "fixed_accounts_user_provider_uq" ON "fixed_accounts" USING btree ("user_id","provider");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fixed_accounts_provider_ref_idx" ON "fixed_accounts" USING btree ("provider","provider_ref");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fixed_accounts_country_activated_idx" ON "fixed_accounts" USING btree ("country_code","activated_at");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "deposits" ADD CONSTRAINT "deposits_fixed_account_id_fixed_accounts_id_fk" FOREIGN KEY ("fixed_account_id") REFERENCES "public"."fixed_accounts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
