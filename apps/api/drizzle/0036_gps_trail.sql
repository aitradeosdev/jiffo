CREATE TABLE IF NOT EXISTS "errand_trail" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"errand_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"mocked" boolean DEFAULT false NOT NULL,
	"accuracy" double precision,
	"fixed_at" timestamp with time zone,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_presence" ADD COLUMN "accuracy" double precision;--> statement-breakpoint
ALTER TABLE "agent_presence" ADD COLUMN "fixed_at" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "errand_trail" ADD CONSTRAINT "errand_trail_errand_id_errands_id_fk" FOREIGN KEY ("errand_id") REFERENCES "public"."errands"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "errand_trail" ADD CONSTRAINT "errand_trail_agent_id_users_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "errand_trail_errand_idx" ON "errand_trail" USING btree ("errand_id","at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "errand_trail_at_idx" ON "errand_trail" USING btree ("at");