ALTER TABLE "agent_presence" ADD COLUMN "online_since" timestamp with time zone;--> statement-breakpoint
-- Agents online now count as online since their last report.
UPDATE "agent_presence" SET "online_since" = "updated_at" WHERE "online";
