ALTER TABLE "uploads" ADD COLUMN "checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "uploads" ADD COLUMN "sha256" text;--> statement-breakpoint
ALTER TABLE "uploads" ADD COLUMN "size" integer;