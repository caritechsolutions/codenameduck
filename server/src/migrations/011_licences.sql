-- Phase 3 Part B3c: LG app licence tokens (per SI partner, shared by every tenant, superadmin
-- only). token_enc = AES-256-GCM with <dataDir>/secret.key; token_tail = last 6 chars for the UI.
CREATE TABLE licences (
  id          INTEGER PRIMARY KEY,
  app_id      TEXT NOT NULL UNIQUE,
  filename    TEXT,
  token_enc   TEXT NOT NULL,
  token_tail  TEXT NOT NULL,
  uploaded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
