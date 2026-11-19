CREATE TABLE IF NOT EXISTS "user_networks" (
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"fingerprint" text NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_networks_user_id_kind_fingerprint_pk" PRIMARY KEY("user_id","kind","fingerprint")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_networks" ADD CONSTRAINT "user_networks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_networks_fingerprint_idx" ON "user_networks" USING btree ("fingerprint","last_seen_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_networks_last_seen_idx" ON "user_networks" USING btree ("last_seen_at");