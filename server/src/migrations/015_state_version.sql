-- Part D2: monotonically increasing per-tenant state version. Bumped whenever the TV state can
-- have changed (every hub refresh); carried by register/poll answers, WS pushes and the bundled
-- state.json so a set can tell its localStorage cache and its bundle apart at boot.
ALTER TABLE tenants ADD COLUMN state_version INTEGER NOT NULL DEFAULT 1;
