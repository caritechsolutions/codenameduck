-- Phase 3 Part B1: per-tenant media library. Files live under
-- tenants/<name>/procentric/application/media/<uuid>.<ext> (same origin as the TV app,
-- immutable cache); thumbnails under media/thumbs/<uuid>.jpg. The row is the source of truth
-- for names and dimensions; deleting a row deletes the files.
CREATE TABLE media (
  id         INTEGER PRIMARY KEY,
  tenant_id  INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  uuid       TEXT NOT NULL UNIQUE,
  kind       TEXT NOT NULL CHECK (kind IN ('image', 'video')),
  ext        TEXT NOT NULL,
  mime       TEXT NOT NULL,
  name       TEXT NOT NULL,                        -- display name (editable)
  bytes      INTEGER NOT NULL,
  width      INTEGER,
  height     INTEGER,
  has_thumb  INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX media_tenant ON media(tenant_id, created_at);
