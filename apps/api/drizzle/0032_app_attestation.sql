CREATE TABLE IF NOT EXISTS "app_attest_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_key" text NOT NULL,
	"key_id" text NOT NULL,
	"app_id" text NOT NULL,
	"public_key" text NOT NULL,
	"counter" integer DEFAULT 0 NOT NULL,
	"development" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "attestation_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_key" text NOT NULL,
	"nonce_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "device_attestations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_key" text NOT NULL,
	"user_id" uuid,
	"app" text NOT NULL,
	"platform" text NOT NULL,
	"purpose" text NOT NULL,
	"verdict" text NOT NULL,
	"reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "device_attestations" ADD CONSTRAINT "device_attestations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "app_attest_keys_key_uq" ON "app_attest_keys" USING btree ("key_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_attest_keys_device_idx" ON "app_attest_keys" USING btree ("device_key");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "attestation_challenges_nonce_uq" ON "attestation_challenges" USING btree ("nonce_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "attestation_challenges_expires_idx" ON "attestation_challenges" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "device_attestations_device_idx" ON "device_attestations" USING btree ("device_key","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "device_attestations_user_idx" ON "device_attestations" USING btree ("user_id","created_at");