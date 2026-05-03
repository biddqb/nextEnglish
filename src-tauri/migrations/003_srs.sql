-- v3 schema: SRS / FSRS card storage. One card per saved segment (UNIQUE on
-- segment_id), state mutates in place after each review. We deliberately
-- skip a `review` history table for v2 phase 1 — the loop works without it,
-- and stats UI is deferred. Reintroduce as v4 when stats land.

CREATE TABLE IF NOT EXISTS card (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    segment_id      INTEGER NOT NULL UNIQUE REFERENCES segment(id) ON DELETE CASCADE,
    saved_at        TEXT NOT NULL,
    -- FSRS state. Defaults are the "new card" preset from ts-fsrs.
    due_at          TEXT NOT NULL,
    stability       REAL NOT NULL DEFAULT 0,
    difficulty      REAL NOT NULL DEFAULT 0,
    reps            INTEGER NOT NULL DEFAULT 0,
    lapses          INTEGER NOT NULL DEFAULT 0,
    state           TEXT NOT NULL DEFAULT 'new',
    last_review_at  TEXT
);

CREATE INDEX IF NOT EXISTS idx_card_segment ON card(segment_id);
CREATE INDEX IF NOT EXISTS idx_card_due ON card(due_at);

INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (3, datetime('now'));
