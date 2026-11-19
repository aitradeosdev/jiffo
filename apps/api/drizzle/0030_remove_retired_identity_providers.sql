-- Smile ID is the only identity provider now (docs/security-plan.md, I8): keys saved for Dojah and Youverify
-- are deleted, so no third-party credentials are left behind that the panel can no longer show or remove.
DELETE FROM "provider_settings" WHERE "category" = 'identity' AND "provider" IN ('dojah', 'youverify');
