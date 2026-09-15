-- Step 3c: the TV's instant_power property (1 = Instant On enabled) as reported by the set.
ALTER TABLE sets ADD COLUMN instant_power INTEGER;
