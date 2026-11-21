ALTER TABLE "agent_presence" ADD COLUMN "offers_paused_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "errand_offers" ADD COLUMN "counts" boolean DEFAULT true NOT NULL;