-- D4: a failed licence is retried with a backoff (1 h, 2 h, 4 h … capped at 24 h) instead of
-- being withheld until edited — a "fail" during a power cut or offline test must not switch
-- Netflix off for good. failed_count drives the window; a "success" clears the failure.
ALTER TABLE licences ADD COLUMN failed_count INTEGER NOT NULL DEFAULT 0;
