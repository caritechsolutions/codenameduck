-- Step 3b: per-group power mode (NULL = leave the set as is, 'NORMAL' or 'WARM' = Instant On).
ALTER TABLE groups ADD COLUMN power_mode TEXT CHECK (power_mode IN ('NORMAL','WARM'));
