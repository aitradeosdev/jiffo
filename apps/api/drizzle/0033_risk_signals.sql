ALTER TABLE "agent_presence" ADD COLUMN "mocked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "device_attestations" ADD COLUMN "signals" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "risk_signals" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "risk_signals_at" timestamp with time zone;