ALTER TABLE "otp_challenges" ADD COLUMN "country_code" char(2);--> statement-breakpoint
ALTER TABLE "otp_challenges" ADD COLUMN "device_key" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "absolute_expires_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "otp_device_created_idx" ON "otp_challenges" USING btree ("device_key","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "otp_country_created_idx" ON "otp_challenges" USING btree ("country_code","created_at");