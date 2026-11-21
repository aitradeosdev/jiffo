CREATE TABLE "errand_offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"errand_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"country_code" char(2) NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"fee_kobo" bigint NOT NULL,
	"rank" smallint NOT NULL,
	"score" double precision NOT NULL,
	"parts" jsonb NOT NULL,
	"travel_seconds" integer NOT NULL,
	"travel_estimated" boolean NOT NULL,
	"straight_meters" integer NOT NULL,
	"offered_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"answered_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "errand_offers" ADD CONSTRAINT "errand_offers_errand_id_errands_id_fk" FOREIGN KEY ("errand_id") REFERENCES "public"."errands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "errand_offers" ADD CONSTRAINT "errand_offers_agent_id_users_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "errand_offers_open_errand_uq" ON "errand_offers" USING btree ("errand_id") WHERE status = 'open';--> statement-breakpoint
CREATE UNIQUE INDEX "errand_offers_open_agent_uq" ON "errand_offers" USING btree ("agent_id") WHERE status = 'open';--> statement-breakpoint
CREATE INDEX "errand_offers_errand_idx" ON "errand_offers" USING btree ("errand_id","offered_at");--> statement-breakpoint
CREATE INDEX "errand_offers_agent_idx" ON "errand_offers" USING btree ("agent_id","offered_at");