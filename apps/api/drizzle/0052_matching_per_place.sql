CREATE TABLE "matching_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" text NOT NULL,
	"scope_id" uuid NOT NULL,
	"country_code" char(2) NOT NULL,
	"version" integer NOT NULL,
	"data" jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "errands" ADD COLUMN "broadcast_reach_m" integer;--> statement-breakpoint
ALTER TABLE "matching_overrides" ADD CONSTRAINT "matching_overrides_country_code_countries_code_fk" FOREIGN KEY ("country_code") REFERENCES "public"."countries"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "matching_overrides_scope_version_uq" ON "matching_overrides" USING btree ("scope","scope_id","version");