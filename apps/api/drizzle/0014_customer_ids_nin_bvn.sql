-- Customers verify with their NIN or BVN and a selfie; ID documents are for agents. Settings saved with the
-- old default (the NIN and three documents) take the new one; any other choice keeps its NIN or BVN.
UPDATE "settings_versions"
SET "data" = jsonb_set(
  "data",
  '{identity,customerIdTypes}',
  CASE
    WHEN "data"->'identity'->'customerIdTypes' = '["nin", "drivers_licence", "voters_card", "passport"]'::jsonb
      THEN '["nin", "bvn"]'::jsonb
    ELSE coalesce(
      (SELECT jsonb_agg(t) FROM jsonb_array_elements_text("data"->'identity'->'customerIdTypes') AS t
        WHERE t IN ('nin', 'bvn')),
      '["nin", "bvn"]'::jsonb
    )
  END
)
WHERE "data" ? 'identity';
