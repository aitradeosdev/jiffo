CREATE TABLE "cloud_ip_ranges" (
	"provider" text NOT NULL,
	"range" "cidr" NOT NULL,
	CONSTRAINT "cloud_ip_ranges_provider_range_pk" PRIMARY KEY("provider","range")
);
--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "sign_in_risk_score" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "sign_in_risk_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
CREATE INDEX "cloud_ip_ranges_range_idx" ON "cloud_ip_ranges" USING gist ("range" inet_ops);