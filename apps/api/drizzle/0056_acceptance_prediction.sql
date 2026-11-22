CREATE TABLE "acceptance_models" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"country_code" char(2) NOT NULL,
	"state_code" text NOT NULL,
	"model" jsonb NOT NULL,
	"offers" integer NOT NULL,
	"log_loss" double precision NOT NULL,
	"trained_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "errand_offers" ADD COLUMN "features" jsonb;--> statement-breakpoint
CREATE INDEX "acceptance_models_state_idx" ON "acceptance_models" USING btree ("country_code","state_code","trained_at");