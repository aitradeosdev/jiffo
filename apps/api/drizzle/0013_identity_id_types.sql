CREATE TABLE IF NOT EXISTS "customer_verifications" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"provider" text NOT NULL,
	"reference" text NOT NULL,
	"id_type" text NOT NULL,
	"outcome" text,
	"checks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"legal_name" text,
	"date_of_birth" text,
	"id_fingerprint" text,
	"pending_id_fingerprint" text,
	"checked_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"decided_by" uuid,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_applications" ADD COLUMN "identity_id_type" text;--> statement-breakpoint
ALTER TABLE "agent_applications" ADD COLUMN "identity_with_bvn" boolean DEFAULT false NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "customer_verifications" ADD CONSTRAINT "customer_verifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "customer_verifications_id_uq" ON "customer_verifications" USING btree ("id_fingerprint") WHERE "customer_verifications"."id_fingerprint" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "customer_verifications_reference_uq" ON "customer_verifications" USING btree ("provider","reference");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "customer_verifications_status_idx" ON "customer_verifications" USING btree ("status");--> statement-breakpoint
-- Checks started before ID types: they were all NIN checks, with the BVN asked for by the app's own screens.
UPDATE "agent_applications" SET "identity_id_type" = 'nin', "identity_with_bvn" = ("identity_provider" = 'fake') WHERE "identity_reference" IS NOT NULL;
