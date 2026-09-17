-- Phase 3 Part B3b: app activation. Each set reports idcap://application/register/status per
-- discovered app (at register and after a register_apps command); the last registration
-- result (application_registration_result_received) is kept per set. Tenant token /
-- account-number config lives in tenants.settings_json.app_activation.
CREATE TABLE set_app_status (
  set_id     INTEGER NOT NULL REFERENCES sets(id) ON DELETE CASCADE,
  app_id     TEXT NOT NULL,
  activated  INTEGER,                              -- 1 activated, 0 not, NULL unknown
  status     TEXT,                                 -- the auth / status string LG returned
  raw_json   TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (set_id, app_id)
);
CREATE TABLE set_app_registration (
  set_id      INTEGER PRIMARY KEY REFERENCES sets(id) ON DELETE CASCADE,
  ok          INTEGER,
  result_json TEXT,
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
