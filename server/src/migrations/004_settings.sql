-- Step 5: tenant settings blob (weather location, logo, timezone), users bookkeeping.
ALTER TABLE tenants ADD COLUMN settings_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE users ADD COLUMN updated_at TEXT;
ALTER TABLE users ADD COLUMN last_login TEXT;
