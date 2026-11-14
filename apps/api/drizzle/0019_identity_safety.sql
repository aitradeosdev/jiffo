CREATE TABLE IF NOT EXISTS "identity_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"user_id" uuid,
	"reference" text,
	"binding" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "webhook_signatures" (
	"provider" text NOT NULL,
	"signature" text NOT NULL,
	"body_hash" text NOT NULL,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_signatures_provider_signature_pk" PRIMARY KEY("provider","signature")
);
--> statement-breakpoint
ALTER TABLE "agent_applications" ADD COLUMN "identity_session_id" uuid;--> statement-breakpoint
ALTER TABLE "customer_verifications" ADD COLUMN "session_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "identity_attempts" ADD CONSTRAINT "identity_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "identity_attempts_user_ix" ON "identity_attempts" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "identity_attempts_reference_ix" ON "identity_attempts" USING btree ("reference","created_at");