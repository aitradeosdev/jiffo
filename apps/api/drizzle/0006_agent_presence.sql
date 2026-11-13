CREATE TABLE IF NOT EXISTS "agent_presence" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"country_code" text NOT NULL,
	"online" boolean DEFAULT false NOT NULL,
	"lat" double precision,
	"lng" double precision,
	"location" geography(Point, 4326),
	"located_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_presence" ADD CONSTRAINT "agent_presence_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_presence_location_gix" ON "agent_presence" USING gist ("location");