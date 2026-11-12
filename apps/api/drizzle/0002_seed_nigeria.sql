-- Nigeria: the first country. Every state starts switched on (nationwide launch); admin can switch any off.
INSERT INTO countries (code, name, currency, phone_prefix, timezone, enabled) VALUES ('NG', 'Nigeria', 'NGN', '+234', 'Africa/Lagos', true);
--> statement-breakpoint
INSERT INTO states (country_code, code, name, enabled) VALUES
  ('NG', 'AB', 'Abia', true),
  ('NG', 'AD', 'Adamawa', true),
  ('NG', 'AK', 'Akwa Ibom', true),
  ('NG', 'AN', 'Anambra', true),
  ('NG', 'BA', 'Bauchi', true),
  ('NG', 'BY', 'Bayelsa', true),
  ('NG', 'BE', 'Benue', true),
  ('NG', 'BO', 'Borno', true),
  ('NG', 'CR', 'Cross River', true),
  ('NG', 'DE', 'Delta', true),
  ('NG', 'EB', 'Ebonyi', true),
  ('NG', 'ED', 'Edo', true),
  ('NG', 'EK', 'Ekiti', true),
  ('NG', 'EN', 'Enugu', true),
  ('NG', 'FC', 'Federal Capital Territory', true),
  ('NG', 'GO', 'Gombe', true),
  ('NG', 'IM', 'Imo', true),
  ('NG', 'JI', 'Jigawa', true),
  ('NG', 'KD', 'Kaduna', true),
  ('NG', 'KN', 'Kano', true),
  ('NG', 'KT', 'Katsina', true),
  ('NG', 'KE', 'Kebbi', true),
  ('NG', 'KO', 'Kogi', true),
  ('NG', 'KW', 'Kwara', true),
  ('NG', 'LA', 'Lagos', true),
  ('NG', 'NA', 'Nasarawa', true),
  ('NG', 'NI', 'Niger', true),
  ('NG', 'OG', 'Ogun', true),
  ('NG', 'ON', 'Ondo', true),
  ('NG', 'OS', 'Osun', true),
  ('NG', 'OY', 'Oyo', true),
  ('NG', 'PL', 'Plateau', true),
  ('NG', 'RI', 'Rivers', true),
  ('NG', 'SO', 'Sokoto', true),
  ('NG', 'TA', 'Taraba', true),
  ('NG', 'YO', 'Yobe', true),
  ('NG', 'ZA', 'Zamfara', true);
--> statement-breakpoint
-- The starting categories from the spec; admin adds, edits, switches off and deletes them.
INSERT INTO categories (country_code, key, name, icon, buy_default, description, sort) VALUES
  ('NG', 'groceries', 'Groceries & market', 'cart', true, 'A Shoprite run, a market list', 10),
  ('NG', 'food', 'Food & drinks', 'food', true, 'Lunch from a buka, a restaurant order', 20),
  ('NG', 'pharmacy', 'Pharmacy', 'pill', true, 'Over-the-counter medicine, baby supplies', 30),
  ('NG', 'shopping', 'Shopping & returns', 'bag', true, 'Buy from a store, return an item', 40),
  ('NG', 'laundry', 'Laundry', 'shirt', true, 'Dry cleaner drop-off and pickup', 50),
  ('NG', 'parcel', 'Parcels & documents', 'box', false, 'Drop off a parcel, collect documents', 60),
  ('NG', 'queue', 'Queues & in-person tasks', 'users', false, 'Hold a place in a queue, submit forms', 70),
  ('NG', 'other', 'Anything else', 'spark', false, 'Any legal errand that fits none of these', 80);
--> statement-breakpoint
-- Settings version 1: sample starting values from the prototypes, to be set in admin before launch.
INSERT INTO settings_versions (country_code, version, data) VALUES ('NG', 1, '{"pricing":{"baseFeeKobo":50000,"ratePerKmKobo":20000,"minFeeKobo":100000},"fees":{"serviceFeeBps":1000,"serviceFeeMinKobo":10000,"serviceFeeCapKobo":100000,"commissionBps":{"bronze":1500,"silver":1250,"gold":1000,"platinum":800},"launchCommissionBps":null,"instantWithdrawalFeeKobo":10000},"timers":{"urgentWidenMinutes":5,"raisePricePromptMinutes":15,"urgentExpiryMinutes":30,"boardRaisePromptMinutes":30,"itemLockMinutes":30,"dropoffWaitMinutes":10,"autoReleaseHours":24,"unreachableHours":24,"disputeResponseHours":24,"disputeDecisionHours":48,"bronzePayoutHoldHours":24},"limits":{"newCustomerItemLimitKobo":5000000,"newAgentItemLimitKobo":3000000,"newAgentDailyWithdrawalKobo":5000000,"strikeThreshold":3,"pinAttempts":5,"otpAttempts":5,"otpPerHour":5,"otpResendSeconds":60,"otpTtlSeconds":300},"identity":{"mode":"manual","provider":null,"customerIdTypes":["nin","drivers_licence","voters_card","passport"],"agentIdTypes":["nin","bvn"],"requireBvnForAgents":true,"addressCheck":"physical","selfieTries":3,"reviewTargetHours":24},"profiles":{"showCustomerPhotoBeforeAccept":false}}'::jsonb);
