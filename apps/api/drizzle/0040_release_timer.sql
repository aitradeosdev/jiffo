ALTER TABLE "errands" ADD COLUMN "release_due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "errands" ADD COLUMN "release_paused_at" timestamp with time zone;--> statement-breakpoint
-- Drop-off photos already waiting: due at the photo's time (or the errand's last change, without one) plus the
-- auto-release hours their errand was made under (24 without them).
UPDATE "errands" e SET "release_due_at" = coalesce(photo.at, e."updated_at")
  + make_interval(hours => coalesce((sv."data"->'timers'->>'autoReleaseHours')::int, 24))
FROM "errands" w
LEFT JOIN (
  SELECT "errand_id", max("created_at") AS at FROM "errand_events" WHERE "event" = 'send_dropoff_photo' GROUP BY "errand_id"
) photo ON photo."errand_id" = w."id"
LEFT JOIN "settings_versions" sv ON sv."country_code" = w."country_code" AND sv."version" = w."settings_version"
WHERE w."id" = e."id" AND e."status" = 'photo_pending' AND e."release_due_at" IS NULL;
