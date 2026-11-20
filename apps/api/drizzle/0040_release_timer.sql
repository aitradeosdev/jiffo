ALTER TABLE "errands" ADD COLUMN "release_due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "errands" ADD COLUMN "release_paused_at" timestamp with time zone;--> statement-breakpoint
-- Drop-off photos already waiting: due at the photo's time plus the auto-release hours their errand was made under.
UPDATE "errands" e SET "release_due_at" = photo.at + make_interval(hours => coalesce((sv."data"->'timers'->>'autoReleaseHours')::int, 24))
FROM (
  SELECT "errand_id", max("created_at") AS at FROM "errand_events" WHERE "event" = 'send_dropoff_photo' GROUP BY "errand_id"
) photo, "settings_versions" sv
WHERE e."status" = 'photo_pending' AND e."release_due_at" IS NULL AND photo."errand_id" = e."id"
  AND sv."country_code" = e."country_code" AND sv."version" = e."settings_version";
