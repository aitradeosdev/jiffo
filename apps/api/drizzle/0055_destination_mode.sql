CREATE TABLE "agent_destinations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"country_code" char(2) NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"label" text NOT NULL,
	"set_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"ended_reason" text
);
--> statement-breakpoint
ALTER TABLE "agent_presence" ADD COLUMN "destination_lat" double precision;--> statement-breakpoint
ALTER TABLE "agent_presence" ADD COLUMN "destination_lng" double precision;--> statement-breakpoint
ALTER TABLE "agent_presence" ADD COLUMN "destination_label" text;--> statement-breakpoint
ALTER TABLE "agent_presence" ADD COLUMN "destination_set_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agent_destinations" ADD CONSTRAINT "agent_destinations_agent_id_users_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_destinations_agent_idx" ON "agent_destinations" USING btree ("agent_id","set_at");