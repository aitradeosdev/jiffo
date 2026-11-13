CREATE TABLE IF NOT EXISTS "agent_applications" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"country_code" char(2) NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"state_code" text,
	"area" text,
	"nin_fingerprint" text,
	"identity_reference" text,
	"identity_outcome" text,
	"identity_checked_at" timestamp with time zone,
	"legal_name" text,
	"date_of_birth" text,
	"address" text,
	"emergency_name" text,
	"emergency_phone" text,
	"emergency_relationship" text,
	"address_reference" text,
	"address_outcome" text,
	"terms_accepted_at" timestamp with time zone,
	"checks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"submitted_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"decided_by" uuid,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_applications" ADD CONSTRAINT "agent_applications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_applications" ADD CONSTRAINT "agent_applications_country_code_countries_code_fk" FOREIGN KEY ("country_code") REFERENCES "public"."countries"("code") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_applications_nin_uq" ON "agent_applications" USING btree ("nin_fingerprint") WHERE "agent_applications"."nin_fingerprint" is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_applications_status_idx" ON "agent_applications" USING btree ("country_code","status");