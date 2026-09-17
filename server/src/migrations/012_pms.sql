-- Phase 3 Part C: local PMS. Reservations per tenant and room; occupancy is derived from dates
-- (checkin_date <= D < checkout_date, status booked|checked_in). pms_log records every change
-- (manual, import, api, scheduler). Import profiles keep a named column mapping per tenant.
CREATE TABLE reservations (
  id             INTEGER PRIMARY KEY,
  tenant_id      INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  room_number    TEXT NOT NULL,
  first_name     TEXT NOT NULL DEFAULT '',
  last_name      TEXT NOT NULL DEFAULT '',
  checkin_date   TEXT NOT NULL,                       -- YYYY-MM-DD (tenant local date)
  checkout_date  TEXT NOT NULL,                       -- YYYY-MM-DD, > checkin_date
  lang           TEXT,
  vip            INTEGER NOT NULL DEFAULT 0,
  notes          TEXT,
  source         TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','import','api')),
  status         TEXT NOT NULL DEFAULT 'booked' CHECK (status IN ('booked','checked_in','checked_out','cancelled')),
  checked_in_at  TEXT,
  checked_out_at TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX reservations_room ON reservations(tenant_id, room_number, checkin_date);
CREATE INDEX reservations_status ON reservations(tenant_id, status);

CREATE TABLE pms_log (
  id             INTEGER PRIMARY KEY,
  tenant_id      INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  reservation_id INTEGER REFERENCES reservations(id) ON DELETE SET NULL,
  event          TEXT NOT NULL,                       -- created|updated|checked_in|checked_out|cancelled|expired|imported
  source         TEXT NOT NULL,                       -- manual|import|api|scheduler
  payload_json   TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX pms_log_tenant ON pms_log(tenant_id, id);

CREATE TABLE import_profiles (
  id           INTEGER PRIMARY KEY,
  tenant_id    INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  mapping_json TEXT NOT NULL,                         -- {mapping: {room, first_name, ...}, date_format, delimiter?}
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (tenant_id, name)
);

-- Group options: layout shown while the room is vacant (NULL = the normal layout with blank
-- variables) and a welcome popup for N seconds at check-in (0 = none).
ALTER TABLE groups ADD COLUMN vacant_layout_id INTEGER REFERENCES layouts(id) ON DELETE SET NULL;
ALTER TABLE groups ADD COLUMN welcome_popup_s INTEGER NOT NULL DEFAULT 0;

-- External PMS API key (sha256 of the key; the key itself is shown once).
ALTER TABLE tenants ADD COLUMN pms_api_key_hash TEXT;
ALTER TABLE tenants ADD COLUMN pms_api_key_prefix TEXT;
ALTER TABLE tenants ADD COLUMN pms_api_key_created_at TEXT;
