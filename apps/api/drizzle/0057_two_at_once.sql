ALTER TABLE "errand_offers" ADD COLUMN "paired_with" uuid;--> statement-breakpoint
ALTER TABLE "errand_offers" ADD COLUMN "pair_order" jsonb;--> statement-breakpoint
ALTER TABLE "errand_offers" ADD CONSTRAINT "errand_offers_paired_with_errands_id_fk" FOREIGN KEY ("paired_with") REFERENCES "public"."errands"("id") ON DELETE no action ON UPDATE no action;