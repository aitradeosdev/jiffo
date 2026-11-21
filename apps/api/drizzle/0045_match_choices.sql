CREATE TABLE "match_blocks" (
	"user_id" uuid NOT NULL,
	"other_user_id" uuid NOT NULL,
	"errand_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "match_blocks_user_id_other_user_id_pk" PRIMARY KEY("user_id","other_user_id"),
	CONSTRAINT "match_blocks_not_self_ck" CHECK ("match_blocks"."user_id" <> "match_blocks"."other_user_id")
);
--> statement-breakpoint
ALTER TABLE "agent_profiles" ADD COLUMN "work_radius_km" smallint;--> statement-breakpoint
ALTER TABLE "match_blocks" ADD CONSTRAINT "match_blocks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_blocks" ADD CONSTRAINT "match_blocks_other_user_id_users_id_fk" FOREIGN KEY ("other_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_blocks" ADD CONSTRAINT "match_blocks_errand_id_errands_id_fk" FOREIGN KEY ("errand_id") REFERENCES "public"."errands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "match_blocks_other_idx" ON "match_blocks" USING btree ("other_user_id");--> statement-breakpoint
ALTER TABLE "agent_profiles" ADD CONSTRAINT "agent_profiles_work_radius_ck" CHECK ("agent_profiles"."work_radius_km" between 1 and 50);