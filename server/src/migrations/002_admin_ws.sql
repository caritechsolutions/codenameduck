-- Step 2: admin sessions, heartbeat fields on sets.

CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at TEXT NOT NULL,
  last_seen  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ip         TEXT
);
CREATE INDEX sessions_user ON sessions(user_id);

ALTER TABLE sets ADD COLUMN reported_room TEXT;      -- raw room_number property from the TV ([TV]<serial> = factory)
ALTER TABLE sets ADD COLUMN power_mode TEXT;         -- NORMAL | WARM (from heartbeat)
ALTER TABLE sets ADD COLUMN volume INTEGER;
ALTER TABLE sets ADD COLUMN muted INTEGER;
ALTER TABLE sets ADD COLUMN channel TEXT;            -- current channel number as reported
ALTER TABLE sets ADD COLUMN uptime_s INTEGER;
ALTER TABLE sets ADD COLUMN last_hb TEXT;
