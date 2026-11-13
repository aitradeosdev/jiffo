CREATE TABLE IF NOT EXISTS "agent_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"tier" text DEFAULT 'bronze' NOT NULL,
	"tier_set_by" uuid,
	"tier_set_at" timestamp with time zone,
	"category_keys" text[],
	"takes_purchases" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_profiles" ADD CONSTRAINT "agent_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
