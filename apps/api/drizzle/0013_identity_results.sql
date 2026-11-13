CREATE TABLE IF NOT EXISTS "identity_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"reference" text NOT NULL,
	"outcome" text NOT NULL,
	"legal_name" text,
	"date_of_birth" text,
	"checks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"nin_fingerprint" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "identity_results_uq" ON "identity_results" USING btree ("provider","reference");