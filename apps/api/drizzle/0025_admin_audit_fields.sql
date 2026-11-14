ALTER TABLE "admin_audit" ALTER COLUMN "admin_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "admin_approvals" ADD COLUMN "requested_user_agent" text;--> statement-breakpoint
ALTER TABLE "admin_audit" ADD COLUMN "via" text DEFAULT 'panel' NOT NULL;--> statement-breakpoint
ALTER TABLE "admin_audit" ADD COLUMN "reason" text;--> statement-breakpoint
ALTER TABLE "admin_audit" ADD COLUMN "user_agent" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "admin_audit_admin_created_idx" ON "admin_audit" USING btree ("admin_id","action","created_at");--> statement-breakpoint
ALTER TABLE "admin_audit" ADD CONSTRAINT "admin_audit_actor" CHECK ("admin_audit"."admin_id" is not null or "admin_audit"."via" = 'cli');--> statement-breakpoint
-- The audit log is append-only (docs/security-plan.md, D7): rows can be added, never changed or removed.
CREATE OR REPLACE FUNCTION admin_audit_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'admin_audit is append-only: % is not allowed', TG_OP;
END;
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS admin_audit_no_change ON "admin_audit";--> statement-breakpoint
CREATE TRIGGER admin_audit_no_change BEFORE UPDATE OR DELETE ON "admin_audit"
  FOR EACH ROW EXECUTE FUNCTION admin_audit_append_only();--> statement-breakpoint
DROP TRIGGER IF EXISTS admin_audit_no_truncate ON "admin_audit";--> statement-breakpoint
CREATE TRIGGER admin_audit_no_truncate BEFORE TRUNCATE ON "admin_audit"
  FOR EACH STATEMENT EXECUTE FUNCTION admin_audit_append_only();
