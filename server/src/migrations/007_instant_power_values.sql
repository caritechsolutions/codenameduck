-- Phase 3: instant_power has four values on LG sets (property list):
--   0 = off, 1 = Instant On with update-on-off (passes through STANDBY, slow), 2 = Instant On
--   (remote off goes straight to WARM(WAIT)), 10 = Always On. Groups store the desired value;
--   NULL = leave the set as is. Old WARM/NORMAL setting is migrated (WARM → 2, NORMAL → 0).
ALTER TABLE groups ADD COLUMN instant_power INTEGER CHECK (instant_power IN (0, 1, 2, 10));
UPDATE groups SET instant_power = CASE power_mode WHEN 'WARM' THEN 2 WHEN 'NORMAL' THEN 0 ELSE NULL END;
