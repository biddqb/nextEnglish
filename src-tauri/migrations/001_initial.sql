-- Initial schema for nextEnglish v1.
-- Eng review A6: schema_version table exists from day 1 so v2 doesn't need a retrofit.

CREATE TABLE IF NOT EXISTS schema_version (
    version    INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS clip (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    title           TEXT NOT NULL,
    source_uri      TEXT NOT NULL,
    audio_path      TEXT NOT NULL,
    duration_ms     INTEGER NOT NULL,
    transcript_json TEXT NOT NULL,
    created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS segment (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    clip_id   INTEGER NOT NULL REFERENCES clip(id) ON DELETE CASCADE,
    start_ms  INTEGER NOT NULL,
    end_ms    INTEGER NOT NULL,
    text      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS session (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    segment_id INTEGER NOT NULL REFERENCES segment(id) ON DELETE CASCADE,
    started_at TEXT NOT NULL,
    ended_at   TEXT
);

CREATE TABLE IF NOT EXISTS attempt (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id          INTEGER NOT NULL REFERENCES session(id) ON DELETE CASCADE,
    attempt_audio_path  TEXT NOT NULL,
    asr_transcript      TEXT NOT NULL,
    score_overall       INTEGER NOT NULL,
    score_word_accuracy REAL NOT NULL,
    score_cadence       REAL NOT NULL,
    score_pitch_corr    REAL,
    recorded_at         TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_segment_clip ON segment(clip_id);
CREATE INDEX IF NOT EXISTS idx_session_segment ON session(segment_id);
CREATE INDEX IF NOT EXISTS idx_attempt_session ON attempt(session_id);

INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (1, datetime('now'));
