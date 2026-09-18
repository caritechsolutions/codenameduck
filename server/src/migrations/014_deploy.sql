-- Phase 3 Part D: remote-deploy mode. Per tenant: run (TV fetches index.html live) or deploy
-- (TV downloads app.zip and runs it locally). The server manages the xait versions: they bump
-- only when the bundle content (renderer files + media) changes.
ALTER TABLE tenants ADD COLUMN deploy_mode TEXT NOT NULL DEFAULT 'run' CHECK (deploy_mode IN ('run', 'deploy'));
ALTER TABLE tenants ADD COLUMN bundle_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tenants ADD COLUMN bundle_hash TEXT;
ALTER TABLE tenants ADD COLUMN bundle_build TEXT;
ALTER TABLE tenants ADD COLUMN bundle_built_at TEXT;
-- What each set reported at its last register: the bundle it runs and its page origin.
ALTER TABLE sets ADD COLUMN bundle_version INTEGER;
ALTER TABLE sets ADD COLUMN origin TEXT;
