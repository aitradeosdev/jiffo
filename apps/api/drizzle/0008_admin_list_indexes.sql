CREATE INDEX IF NOT EXISTS "deposits_country_created_idx" ON "deposits" USING btree ("country_code","created_at","id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "errands_country_created_idx" ON "errands" USING btree ("country_code","created_at","id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payouts_country_created_idx" ON "payouts" USING btree ("country_code","created_at","id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_country_created_idx" ON "users" USING btree ("country_code","created_at","id");