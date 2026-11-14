CREATE TABLE IF NOT EXISTS "admin_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"permission" text NOT NULL,
	"country_code" char(2),
	"target_type" text,
	"target_id" text,
	"summary" text NOT NULL,
	"payload" jsonb NOT NULL,
	"requested_by" uuid NOT NULL,
	"requested_ip" text,
	"note" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"self_approved" boolean DEFAULT false NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"result" jsonb,
	"error" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_approvals_second_person" CHECK ("admin_approvals"."decided_by" is null or "admin_approvals"."decided_by" <> "admin_approvals"."requested_by" or "admin_approvals"."self_approved" or "admin_approvals"."status" = 'cancelled')
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "admin_approvals" ADD CONSTRAINT "admin_approvals_requested_by_admins_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "admin_approvals" ADD CONSTRAINT "admin_approvals_decided_by_admins_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "admin_approvals_status_idx" ON "admin_approvals" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "admin_approvals_requested_idx" ON "admin_approvals" USING btree ("requested_by","created_at");