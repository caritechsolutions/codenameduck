-- CoopCentric schema v1. Mirrors docs/PLATFORM.md "Data model". RF channel types are
-- modelled from day one (channels.type + params_json) even though only IP is used now.

CREATE TABLE tenants (
  id                INTEGER PRIMARY KEY,
  name              TEXT NOT NULL UNIQUE,          -- slug, == directory under /srv/coopcentric/tenants
  hostname          TEXT NOT NULL UNIQUE,
  display_name      TEXT NOT NULL,
  default_layout_id INTEGER REFERENCES layouts(id) ON DELETE SET NULL,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE users (
  id            INTEGER PRIMARY KEY,
  tenant_id     INTEGER REFERENCES tenants(id) ON DELETE CASCADE,   -- NULL = superadmin
  username      TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('superadmin','tenant-admin')),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (tenant_id, username)
);

CREATE TABLE groups (
  id          INTEGER PRIMARY KEY,
  tenant_id   INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  UNIQUE (tenant_id, name)
);

CREATE TABLE layouts (
  id         INTEGER PRIMARY KEY,
  tenant_id  INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1,
  json       TEXT NOT NULL,                        -- layout document (schema 1)
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (tenant_id, name)
);

CREATE TABLE sets (
  id                 INTEGER PRIMARY KEY,
  tenant_id          INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  serial             TEXT NOT NULL,
  token              TEXT NOT NULL,                -- issued at register, required for poll/ws
  mac                TEXT,
  model              TEXT,
  platform_version   TEXT,
  firmware_version   TEXT,
  webos_version      TEXT,
  idpn               TEXT,
  api                TEXT CHECK (api IN ('idcap','hcap')),
  room_number        TEXT,
  group_id           INTEGER REFERENCES groups(id) ON DELETE SET NULL,
  layout_override_id INTEGER REFERENCES layouts(id) ON DELETE SET NULL,
  ip                 TEXT,
  app_version        TEXT,                         -- renderer build the set reported
  first_seen         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_seen          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  notes              TEXT,
  UNIQUE (tenant_id, serial)
);
CREATE INDEX sets_tenant_group ON sets(tenant_id, group_id);

CREATE TABLE layout_assign (
  group_id  INTEGER PRIMARY KEY REFERENCES groups(id) ON DELETE CASCADE,
  layout_id INTEGER NOT NULL REFERENCES layouts(id) ON DELETE CASCADE
);

CREATE TABLE channels (
  id          INTEGER PRIMARY KEY,
  tenant_id   INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  number      INTEGER NOT NULL,
  name        TEXT NOT NULL,
  logo_url    TEXT,
  type        TEXT NOT NULL CHECK (type IN ('ip','rf')),
  params_json TEXT NOT NULL,                       -- 1:1 with idcap://tv/channel/change/request params
  enabled     INTEGER NOT NULL DEFAULT 1,
  sort        INTEGER NOT NULL DEFAULT 0,
  UNIQUE (tenant_id, number)
);

CREATE TABLE lineups (
  id        INTEGER PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name      TEXT NOT NULL,
  UNIQUE (tenant_id, name)
);

CREATE TABLE lineup_items (
  lineup_id  INTEGER NOT NULL REFERENCES lineups(id) ON DELETE CASCADE,
  channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  position   INTEGER NOT NULL,
  PRIMARY KEY (lineup_id, channel_id)
);

CREATE TABLE lineup_assign (
  group_id  INTEGER PRIMARY KEY REFERENCES groups(id) ON DELETE CASCADE,
  lineup_id INTEGER NOT NULL REFERENCES lineups(id) ON DELETE CASCADE
);

CREATE TABLE messages (
  id          INTEGER PRIMARY KEY,
  tenant_id   INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('set','group','all')),
  target_id   INTEGER,
  text        TEXT NOT NULL,
  expires_at  TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE commands (
  id           INTEGER PRIMARY KEY,
  tenant_id    INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  set_id       INTEGER NOT NULL REFERENCES sets(id) ON DELETE CASCADE,
  type         TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  status       TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','acked','failed')),
  result_json  TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX commands_set_status ON commands(set_id, status);

CREATE TABLE events (
  id           INTEGER PRIMARY KEY,
  tenant_id    INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  set_id       INTEGER REFERENCES sets(id) ON DELETE CASCADE,
  type         TEXT NOT NULL,
  payload_json TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX events_set_time ON events(set_id, created_at);
