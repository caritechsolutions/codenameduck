-- Step 3: per-set lineup override, tenant default lineup, screenshot bookkeeping.
ALTER TABLE sets ADD COLUMN lineup_override_id INTEGER REFERENCES lineups(id) ON DELETE SET NULL;
ALTER TABLE sets ADD COLUMN screenshot_at TEXT;
ALTER TABLE tenants ADD COLUMN default_lineup_id INTEGER REFERENCES lineups(id) ON DELETE SET NULL;
