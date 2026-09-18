-- B3d: a licence whose registration LG answered with tokenResult "fail" is marked here and left
-- out of every registration until the token is replaced or its app id edited (no retry storms,
-- and no re-registering of the other apps alongside it).
ALTER TABLE licences ADD COLUMN failed_model TEXT;
ALTER TABLE licences ADD COLUMN failed_at TEXT;
ALTER TABLE licences ADD COLUMN failed_message TEXT;
