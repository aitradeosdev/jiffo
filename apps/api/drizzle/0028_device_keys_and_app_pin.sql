CREATE TABLE IF NOT EXISTS "device_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" uuid NOT NULL,
	"nonce_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "public_key" text;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "key_added_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "app_pin_hash" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "app_pin_set_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "app_pin_failures" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "app_pin_locked_at" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "device_challenges" ADD CONSTRAINT "device_challenges_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "device_challenges_nonce_uq" ON "device_challenges" USING btree ("nonce_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "device_challenges_device_idx" ON "device_challenges" USING btree ("device_id");