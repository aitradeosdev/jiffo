CREATE TABLE IF NOT EXISTS "alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"country_code" char(2),
	"kind" text NOT NULL,
	"dedupe_key" text DEFAULT '' NOT NULL,
	"message" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid,
	"resolve_note" text
);
--> statement-breakpoint
ALTER TABLE "payouts" ADD COLUMN "request_key" text;--> statement-breakpoint
ALTER TABLE "payouts" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "payouts" ADD COLUMN "sending_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reconciliation_runs" ADD COLUMN "pauses_instant" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "reconciliation_runs" ADD COLUMN "cleared_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reconciliation_runs" ADD COLUMN "cleared_by" uuid;--> statement-breakpoint
ALTER TABLE "reconciliation_runs" ADD COLUMN "clear_note" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "alerts" ADD CONSTRAINT "alerts_country_code_countries_code_fk" FOREIGN KEY ("country_code") REFERENCES "public"."countries"("code") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "alerts" ADD CONSTRAINT "alerts_resolved_by_admins_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "alerts_open_uq" ON "alerts" USING btree ("kind","country_code","dedupe_key") WHERE resolved_at is null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "alerts_country_created_idx" ON "alerts" USING btree ("country_code","created_at");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reconciliation_runs" ADD CONSTRAINT "reconciliation_runs_cleared_by_admins_id_fk" FOREIGN KEY ("cleared_by") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payouts_request_key_uq" ON "payouts" USING btree ("user_id","request_key");