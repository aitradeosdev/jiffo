CREATE TABLE IF NOT EXISTS "provider_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category" text NOT NULL,
	"provider" text NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"secrets" text,
	"secret_hints" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_test_at" timestamp with time zone,
	"last_test_ok" boolean,
	"last_test_message" text,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_applications" ADD COLUMN "identity_provider" text;--> statement-breakpoint
ALTER TABLE "agent_applications" ADD COLUMN "address_provider" text;--> statement-breakpoint
ALTER TABLE "payouts" ADD COLUMN "provider" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "provider_settings" ADD CONSTRAINT "provider_settings_updated_by_admins_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "provider_settings_uq" ON "provider_settings" USING btree ("category","provider");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "provider_settings_active_uq" ON "provider_settings" USING btree ("category") WHERE "provider_settings"."active";--> statement-breakpoint
-- Payouts already sent went through their account's provider, and checks already started through the one in use.
UPDATE "payouts" p SET "provider" = a."provider" FROM "payout_accounts" a WHERE a."id" = p."payout_account_id" AND p."provider" IS NULL AND p."status" <> 'requested';
--> statement-breakpoint
UPDATE "agent_applications" SET "identity_provider" = 'fake' WHERE "identity_reference" IS NOT NULL AND "identity_provider" IS NULL;
--> statement-breakpoint
UPDATE "agent_applications" SET "address_provider" = 'fake' WHERE "address_reference" IS NOT NULL AND "address_provider" IS NULL;
