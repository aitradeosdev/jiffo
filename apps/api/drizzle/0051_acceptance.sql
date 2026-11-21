ALTER TABLE "agent_presence" ADD COLUMN "offers_paused_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "errand_offers" ADD COLUMN "counts" boolean DEFAULT true NOT NULL;--> statement-breakpoint
-- Offers made before the acceptance rate counted none: agents didn't know their answers would count.
UPDATE "errand_offers" SET "counts" = false;
