CREATE TABLE IF NOT EXISTS "dispute_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"errand_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"taken_by" uuid,
	"content" jsonb NOT NULL,
	"sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "dispute_evidence" ADD CONSTRAINT "dispute_evidence_errand_id_errands_id_fk" FOREIGN KEY ("errand_id") REFERENCES "public"."errands"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "dispute_evidence" ADD CONSTRAINT "dispute_evidence_taken_by_admins_id_fk" FOREIGN KEY ("taken_by") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dispute_evidence_errand_idx" ON "dispute_evidence" USING btree ("errand_id","created_at");--> statement-breakpoint
-- Evidence packs are fixed once made (docs/security-plan.md, E8): rows can be added, never changed or removed.
CREATE OR REPLACE FUNCTION dispute_evidence_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'dispute_evidence is append-only: % is not allowed', TG_OP;
END;
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS dispute_evidence_no_change ON "dispute_evidence";--> statement-breakpoint
CREATE TRIGGER dispute_evidence_no_change BEFORE UPDATE OR DELETE ON "dispute_evidence"
  FOR EACH ROW EXECUTE FUNCTION dispute_evidence_append_only();--> statement-breakpoint
DROP TRIGGER IF EXISTS dispute_evidence_no_truncate ON "dispute_evidence";--> statement-breakpoint
CREATE TRIGGER dispute_evidence_no_truncate BEFORE TRUNCATE ON "dispute_evidence"
  FOR EACH STATEMENT EXECUTE FUNCTION dispute_evidence_append_only();
