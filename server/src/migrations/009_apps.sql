-- Phase 3 Part B3: apps discovered on the sets (idcap://application/list at register), enabled
-- per group, with admin display-name / icon overrides. group_apps rows = enabled for that group
-- (position = tile order). sets.apps_json = the LG app ids this set last reported.
CREATE TABLE apps (
  id            INTEGER PRIMARY KEY,
  tenant_id     INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  app_id        TEXT NOT NULL,                     -- LG application id (e.g. netflix, youtube.leanback.v4)
  title         TEXT,                              -- title as LG reports it
  icon_url      TEXT,                              -- icon as LG reports it (may be a TV-local path)
  type          TEXT,                              -- LG app type/category if reported
  name_override TEXT,                              -- admin display name
  icon_override TEXT,                              -- admin icon (media library URL)
  models_json   TEXT NOT NULL DEFAULT '[]',        -- models this app was seen on
  raw_json      TEXT,                              -- one raw entry as LG sent it (for the doc)
  first_seen    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_seen     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (tenant_id, app_id)
);
CREATE TABLE group_apps (
  group_id  INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  app_id    INTEGER NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  position  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (group_id, app_id)
);
ALTER TABLE sets ADD COLUMN apps_json TEXT;
