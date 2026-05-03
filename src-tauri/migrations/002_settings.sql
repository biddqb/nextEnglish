-- v2 schema: user-editable app settings (model size, mic device, auto-loop ms,
-- ingest max duration). Per eng review A6 — A6 ships schema_version from day 1
-- so this migration just appends.

CREATE TABLE IF NOT EXISTS settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (2, datetime('now'));
