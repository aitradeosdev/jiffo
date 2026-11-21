CREATE TABLE "errand_broadcasts" (
	"errand_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"fee_kobo" bigint NOT NULL,
	"straight_meters" integer NOT NULL,
	"told_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "errand_broadcasts_errand_id_fee_kobo_agent_id_pk" PRIMARY KEY("errand_id","fee_kobo","agent_id")
);
--> statement-breakpoint
ALTER TABLE "errands" ADD COLUMN "broadcast_fee_kobo" bigint;--> statement-breakpoint
ALTER TABLE "errand_broadcasts" ADD CONSTRAINT "errand_broadcasts_errand_id_errands_id_fk" FOREIGN KEY ("errand_id") REFERENCES "public"."errands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "errand_broadcasts" ADD CONSTRAINT "errand_broadcasts_agent_id_users_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;