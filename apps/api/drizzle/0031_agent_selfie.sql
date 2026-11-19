CREATE TABLE IF NOT EXISTS "agent_selfie_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"provider" text NOT NULL,
	"reference" text NOT NULL,
	"job_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "selfie_needed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "selfie_failures" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "selfie_due" boolean DEFAULT false NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_selfie_checks" ADD CONSTRAINT "agent_selfie_checks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_selfie_checks" ADD CONSTRAINT "agent_selfie_checks_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_selfie_checks_reference_uq" ON "agent_selfie_checks" USING btree ("reference");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_selfie_checks_job_uq" ON "agent_selfie_checks" USING btree ("provider","job_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_selfie_checks_user_idx" ON "agent_selfie_checks" USING btree ("user_id","decided_at");