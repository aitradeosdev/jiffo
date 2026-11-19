ALTER TABLE "users" ADD COLUMN "withdrawals_held_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "withdrawals_held_for" text;