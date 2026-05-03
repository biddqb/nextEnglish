//! SQLite layer. rusqlite + bundled sqlite3, single connection per Database
//! instance. Migration on open, version table from day 1 (eng A6).
//!
//! Schema lives in `migrations/001_initial.sql` and is embedded at compile time.

use std::path::Path;

use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};

use crate::error::{Error, Result};
use crate::models::{
    AttemptRow, CardRow, ClipRow, DueCard, ScoreData, SegmentRow,
};

const SCHEMA_V1: &str = include_str!("../migrations/001_initial.sql");
const SCHEMA_V2: &str = include_str!("../migrations/002_settings.sql");
const SCHEMA_V3: &str = include_str!("../migrations/003_srs.sql");
const SCHEMA_V4: &str = include_str!("../migrations/004_cloze.sql");
const CURRENT_SCHEMA_VERSION: i64 = 4;

const MIGRATIONS: &[(i64, &str)] = &[
    (1, SCHEMA_V1),
    (2, SCHEMA_V2),
    (3, SCHEMA_V3),
    (4, SCHEMA_V4),
];

pub struct Database {
    conn: Connection,
}

impl Database {
    /// Open a database at `path`, creating it and applying migrations if needed.
    /// Pass `:memory:` for an in-memory database (used by tests).
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let conn = Connection::open(path)?;
        conn.execute_batch("PRAGMA foreign_keys = ON;")?;
        let mut db = Self { conn };
        db.migrate()?;
        Ok(db)
    }

    pub fn open_in_memory() -> Result<Self> {
        let conn = Connection::open_in_memory()?;
        conn.execute_batch("PRAGMA foreign_keys = ON;")?;
        let mut db = Self { conn };
        db.migrate()?;
        Ok(db)
    }

    fn migrate(&mut self) -> Result<()> {
        // Always run V1 first — it creates the schema_version table the
        // version check below depends on. V1 itself is idempotent.
        self.conn.execute_batch(SCHEMA_V1)?;

        // Run any subsequent migration whose version isn't yet recorded.
        // This lets non-idempotent migrations (e.g. `ALTER TABLE ADD COLUMN`)
        // safely co-exist with idempotent ones.
        for (version, sql) in MIGRATIONS.iter().filter(|(v, _)| *v > 1) {
            let applied: bool = self
                .conn
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM schema_version WHERE version = ?1)",
                    params![version],
                    |r| r.get(0),
                )
                .unwrap_or(false);
            if !applied {
                self.conn.execute_batch(sql)?;
            }
        }

        let v = self.schema_version()?;
        if v != CURRENT_SCHEMA_VERSION {
            return Err(Error::Other(format!(
                "schema_version {v} does not match expected {CURRENT_SCHEMA_VERSION}",
            )));
        }
        Ok(())
    }

    pub fn schema_version(&self) -> Result<i64> {
        let v: Option<i64> = self
            .conn
            .query_row(
                "SELECT MAX(version) FROM schema_version",
                [],
                |r| r.get(0),
            )
            .optional()?;
        Ok(v.unwrap_or(0))
    }

    pub fn insert_clip(
        &self,
        title: &str,
        source_uri: &str,
        audio_path: &str,
        duration_ms: i64,
        transcript_json: &str,
    ) -> Result<i64> {
        let now = Utc::now().to_rfc3339();
        self.conn.execute(
            "INSERT INTO clip (title, source_uri, audio_path, duration_ms, transcript_json, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![title, source_uri, audio_path, duration_ms, transcript_json, now],
        )?;
        Ok(self.conn.last_insert_rowid())
    }

    pub fn insert_segment(
        &self,
        clip_id: i64,
        start_ms: i64,
        end_ms: i64,
        text: &str,
    ) -> Result<i64> {
        self.conn.execute(
            "INSERT INTO segment (clip_id, start_ms, end_ms, text) VALUES (?1, ?2, ?3, ?4)",
            params![clip_id, start_ms, end_ms, text],
        )?;
        Ok(self.conn.last_insert_rowid())
    }

    /// Save a segment as an SRS card (no-op if already saved). The initial
    /// FSRS state is "due now, stability=0, difficulty=0" — the TS scheduler
    /// fills in real values on the first review. Returns the (possibly
    /// pre-existing) card row.
    pub fn save_card(&self, segment_id: i64) -> Result<CardRow> {
        let now = Utc::now().to_rfc3339();
        // Idempotent: ON CONFLICT does nothing so a re-save doesn't reset
        // FSRS state and the user can't accidentally undo their progress.
        self.conn.execute(
            "INSERT INTO card (segment_id, saved_at, due_at, stability, difficulty,
                               reps, lapses, state, last_review_at)
             VALUES (?1, ?2, ?2, 0, 0, 0, 0, 'new', NULL)
             ON CONFLICT(segment_id) DO NOTHING",
            params![segment_id, now],
        )?;
        self.get_card_for_segment(segment_id)?
            .ok_or_else(|| Error::Other("card disappeared after insert".into()))
    }

    /// Remove a card (the user un-saved a segment). The segment itself is
    /// untouched. ON DELETE CASCADE on the FK means deleting the underlying
    /// segment also drops the card.
    pub fn unsave_card(&self, segment_id: i64) -> Result<()> {
        self.conn.execute(
            "DELETE FROM card WHERE segment_id = ?1",
            params![segment_id],
        )?;
        Ok(())
    }

    pub fn get_card_for_segment(
        &self,
        segment_id: i64,
    ) -> Result<Option<CardRow>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, segment_id, saved_at, due_at, stability, difficulty,
                    reps, lapses, state, last_review_at, cloze_word_indices
             FROM card WHERE segment_id = ?1",
        )?;
        let result = stmt.query_row(params![segment_id], row_to_card);
        match result {
            Ok(c) => Ok(Some(c)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    /// All saved segment_ids for a clip — drives the SegmentList star icon.
    pub fn list_saved_segments(&self, clip_id: i64) -> Result<Vec<i64>> {
        let mut stmt = self.conn.prepare(
            "SELECT c.segment_id
             FROM card c
             JOIN segment s ON s.id = c.segment_id
             WHERE s.clip_id = ?1",
        )?;
        let rows = stmt
            .query_map(params![clip_id], |r| r.get::<_, i64>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    /// Total cards whose due_at is <= now. Drives the sidebar badge.
    pub fn count_due_cards(&self) -> Result<i64> {
        let now = Utc::now().to_rfc3339();
        let count: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM card WHERE due_at <= ?1",
            params![now],
            |r| r.get(0),
        )?;
        Ok(count)
    }

    /// Every saved card joined with its segment + clip context. Used by the
    /// markdown exporter to walk the full saved library, regardless of
    /// due_at. Same return shape as `list_due_cards_with_context` to keep
    /// downstream code uniform.
    pub fn list_all_cards_with_context(&self) -> Result<Vec<DueCard>> {
        let mut stmt = self.conn.prepare(
            "SELECT c.id, c.segment_id, c.saved_at, c.due_at, c.stability,
                    c.difficulty, c.reps, c.lapses, c.state, c.last_review_at,
                    c.cloze_word_indices,
                    cl.id, cl.title, cl.audio_path,
                    (SELECT COUNT(*) FROM segment s2
                       WHERE s2.clip_id = cl.id AND s2.start_ms < seg.start_ms) AS segment_index,
                    seg.text, seg.start_ms, seg.end_ms
             FROM card c
             JOIN segment seg ON seg.id = c.segment_id
             JOIN clip cl ON cl.id = seg.clip_id
             ORDER BY c.saved_at ASC",
        )?;
        let rows = stmt
            .query_map([], |r| {
                Ok(DueCard {
                    card: row_to_card(r)?,
                    clip_id: r.get(11)?,
                    clip_title: r.get(12)?,
                    clip_audio_path: r.get(13)?,
                    segment_index: r.get(14)?,
                    segment_text: r.get(15)?,
                    segment_start_ms: r.get(16)?,
                    segment_end_ms: r.get(17)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    /// Cards due now (or earlier), oldest-due first, joined with segment +
    /// clip context the review UI needs. `audio_path` is returned as stored
    /// (relative or absolute); the command layer resolves to absolute.
    pub fn list_due_cards_with_context(
        &self,
        limit: i64,
    ) -> Result<Vec<DueCard>> {
        let now = Utc::now().to_rfc3339();
        let mut stmt = self.conn.prepare(
            "SELECT c.id, c.segment_id, c.saved_at, c.due_at, c.stability,
                    c.difficulty, c.reps, c.lapses, c.state, c.last_review_at,
                    c.cloze_word_indices,
                    cl.id, cl.title, cl.audio_path,
                    (SELECT COUNT(*) FROM segment s2
                       WHERE s2.clip_id = cl.id AND s2.start_ms < seg.start_ms) AS segment_index,
                    seg.text, seg.start_ms, seg.end_ms
             FROM card c
             JOIN segment seg ON seg.id = c.segment_id
             JOIN clip cl ON cl.id = seg.clip_id
             WHERE c.due_at <= ?1
             ORDER BY c.due_at ASC
             LIMIT ?2",
        )?;
        let rows = stmt
            .query_map(params![now, limit], |r| {
                Ok(DueCard {
                    card: row_to_card(r)?,
                    clip_id: r.get(11)?,
                    clip_title: r.get(12)?,
                    clip_audio_path: r.get(13)?,
                    segment_index: r.get(14)?,
                    segment_text: r.get(15)?,
                    segment_start_ms: r.get(16)?,
                    segment_end_ms: r.get(17)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    /// Replace a card's cloze word indices. Caller passes already-validated
    /// 0-based whitespace-token positions; we serialize to JSON and store.
    /// Empty vec clears all cloze (regular review).
    pub fn set_card_cloze(&self, segment_id: i64, indices: &[i64]) -> Result<()> {
        let json = serde_json::to_string(indices).map_err(|e| {
            Error::Other(format!("serialize cloze indices: {e}"))
        })?;
        let updated = self.conn.execute(
            "UPDATE card SET cloze_word_indices = ?1 WHERE segment_id = ?2",
            params![json, segment_id],
        )?;
        if updated == 0 {
            return Err(Error::Other(format!(
                "no card for segment {segment_id} (save it first)"
            )));
        }
        Ok(())
    }

    /// Apply a review's effect on a card. The TypeScript layer (using
    /// ts-fsrs) computes the new state; we just persist it. `last_review_at`
    /// is set to now.
    #[allow(clippy::too_many_arguments)]
    pub fn record_review(
        &self,
        card_id: i64,
        new_due_at: &str,
        new_stability: f64,
        new_difficulty: f64,
        new_reps: i64,
        new_lapses: i64,
        new_state: &str,
    ) -> Result<()> {
        let now = Utc::now().to_rfc3339();
        let updated = self.conn.execute(
            "UPDATE card
                SET due_at = ?1,
                    stability = ?2,
                    difficulty = ?3,
                    reps = ?4,
                    lapses = ?5,
                    state = ?6,
                    last_review_at = ?7
              WHERE id = ?8",
            params![
                new_due_at,
                new_stability,
                new_difficulty,
                new_reps,
                new_lapses,
                new_state,
                now,
                card_id
            ],
        )?;
        if updated == 0 {
            return Err(Error::Other(format!("no card with id {card_id}")));
        }
        Ok(())
    }

    /// Run a raw SQL statement that doesn't return rows. Used for
    /// administrative ops like `clear_all_clips`. Caller is responsible for
    /// passing a trusted SQL string — this should never accept user input.
    pub fn exec_raw(&self, sql: &str) -> Result<()> {
        self.conn.execute_batch(sql)?;
        Ok(())
    }

    /// Read every persisted user setting as (key, value) pairs. Empty if the
    /// user hasn't customized anything; defaults live in the frontend.
    pub fn list_settings(&self) -> Result<Vec<(String, String)>> {
        let mut stmt = self
            .conn
            .prepare("SELECT key, value FROM settings ORDER BY key ASC")?;
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    /// Upsert a single user setting. Empty value clears it (delete).
    pub fn set_setting(&self, key: &str, value: Option<&str>) -> Result<()> {
        match value {
            Some(v) => {
                let now = Utc::now().to_rfc3339();
                self.conn.execute(
                    "INSERT INTO settings (key, value, updated_at)
                     VALUES (?1, ?2, ?3)
                     ON CONFLICT(key) DO UPDATE SET value = excluded.value,
                                                    updated_at = excluded.updated_at",
                    params![key, v, now],
                )?;
            }
            None => {
                self.conn
                    .execute("DELETE FROM settings WHERE key = ?1", params![key])?;
            }
        }
        Ok(())
    }

    /// Delete a clip and everything that hangs off it (segments → sessions →
    /// attempts) via ON DELETE CASCADE. Returns the deleted clip's
    /// audio_path so the caller can clean up the on-disk directory; returns
    /// `None` if no row matched.
    pub fn delete_clip(&self, clip_id: i64) -> Result<Option<String>> {
        let audio_path: Option<String> = self
            .conn
            .query_row(
                "SELECT audio_path FROM clip WHERE id = ?1",
                params![clip_id],
                |r| r.get(0),
            )
            .optional()?;
        let Some(audio_path) = audio_path else {
            return Ok(None);
        };
        self.conn
            .execute("DELETE FROM clip WHERE id = ?1", params![clip_id])?;
        Ok(Some(audio_path))
    }

    /// Look up a clip by its `source_uri`. Used by the capture flow to
    /// detect a re-capture of the same chunk text and short-circuit to the
    /// existing row instead of creating a duplicate.
    pub fn find_clip_by_source(&self, source_uri: &str) -> Result<Option<ClipRow>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, title, source_uri, audio_path, duration_ms, created_at
             FROM clip WHERE source_uri = ?1 LIMIT 1",
        )?;
        let result = stmt.query_row(params![source_uri], |r| {
            let created_at_str: String = r.get(5)?;
            Ok(ClipRow {
                id: r.get(0)?,
                title: r.get(1)?,
                source_uri: r.get(2)?,
                audio_path: r.get(3)?,
                duration_ms: r.get(4)?,
                created_at: chrono::DateTime::parse_from_rfc3339(&created_at_str)
                    .map(|dt| dt.with_timezone(&Utc))
                    .unwrap_or_else(|_| Utc::now()),
            })
        });
        match result {
            Ok(c) => Ok(Some(c)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    pub fn list_clips(&self) -> Result<Vec<ClipRow>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, title, source_uri, audio_path, duration_ms, created_at
             FROM clip ORDER BY created_at DESC",
        )?;
        let rows = stmt
            .query_map([], |r| {
                let created_at_str: String = r.get(5)?;
                Ok(ClipRow {
                    id: r.get(0)?,
                    title: r.get(1)?,
                    source_uri: r.get(2)?,
                    audio_path: r.get(3)?,
                    duration_ms: r.get(4)?,
                    created_at: chrono::DateTime::parse_from_rfc3339(&created_at_str)
                        .map(|dt| dt.with_timezone(&Utc))
                        .unwrap_or_else(|_| Utc::now()),
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    /// Returns (clip_row, transcript_json_string) or None if not found.
    /// transcript_json is the raw JSON stored at ingest time — full segment +
    /// word-timestamp data, deserialized by the caller as needed.
    pub fn get_clip_with_transcript(
        &self,
        clip_id: i64,
    ) -> Result<Option<(ClipRow, String)>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, title, source_uri, audio_path, duration_ms, created_at, transcript_json
             FROM clip WHERE id = ?1",
        )?;
        let result = stmt.query_row(params![clip_id], |r| {
            let created_at_str: String = r.get(5)?;
            let row = ClipRow {
                id: r.get(0)?,
                title: r.get(1)?,
                source_uri: r.get(2)?,
                audio_path: r.get(3)?,
                duration_ms: r.get(4)?,
                created_at: chrono::DateTime::parse_from_rfc3339(&created_at_str)
                    .map(|dt| dt.with_timezone(&Utc))
                    .unwrap_or_else(|_| Utc::now()),
            };
            let transcript: String = r.get(6)?;
            Ok((row, transcript))
        });
        match result {
            Ok(t) => Ok(Some(t)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    /// Look up a segment row by its position within a clip (0-indexed,
    /// ordered by start_ms ASC).
    pub fn segment_id_for(&self, clip_id: i64, segment_index: i64) -> Result<i64> {
        let mut stmt = self.conn.prepare(
            "SELECT id FROM segment WHERE clip_id = ?1
             ORDER BY start_ms ASC LIMIT 1 OFFSET ?2",
        )?;
        let id: i64 = stmt.query_row(params![clip_id, segment_index], |r| r.get(0))?;
        Ok(id)
    }

    /// Record one attempt: creates a session row + an attempt row in one go.
    /// v1.1 will group multiple attempts into a single session.
    pub fn record_attempt(
        &self,
        clip_id: i64,
        segment_index: i64,
        attempt_audio_path: &str,
        score: &ScoreData,
    ) -> Result<i64> {
        let segment_id = self.segment_id_for(clip_id, segment_index)?;
        let now = Utc::now().to_rfc3339();
        self.conn.execute(
            "INSERT INTO session (segment_id, started_at, ended_at) VALUES (?1, ?2, ?3)",
            params![segment_id, now, now],
        )?;
        let session_id = self.conn.last_insert_rowid();
        self.conn.execute(
            "INSERT INTO attempt
             (session_id, attempt_audio_path, asr_transcript,
              score_overall, score_word_accuracy, score_cadence, score_pitch_corr,
              recorded_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                session_id,
                attempt_audio_path,
                score.user_transcript,
                score.overall,
                score.word_accuracy,
                score.cadence,
                score.pitch_corr,
                now,
            ],
        )?;
        Ok(self.conn.last_insert_rowid())
    }

    /// For every segment in a clip that has at least one recorded attempt,
    /// return (segment_index, best_overall_score, attempt_count). Segments
    /// with no attempts are omitted — the caller fills those slots in the
    /// SegmentList with "no attempts yet" UI. segment_index is 0-based,
    /// computed from the segment row's position when ordered by start_ms.
    pub fn list_segment_best_scores(
        &self,
        clip_id: i64,
    ) -> Result<Vec<(i64, i32, i64)>> {
        // Window-style approach without window functions: rank segments by
        // start_ms and join through session+attempt for max overall.
        let mut stmt = self.conn.prepare(
            "WITH ordered_segments AS (
                 SELECT id,
                        (ROW_NUMBER() OVER (ORDER BY start_ms ASC)) - 1 AS segment_index
                 FROM segment
                 WHERE clip_id = ?1
             )
             SELECT os.segment_index,
                    MAX(a.score_overall) AS best_overall,
                    COUNT(a.id)          AS attempt_count
             FROM ordered_segments os
             JOIN session s ON s.segment_id = os.id
             JOIN attempt a ON a.session_id = s.id
             GROUP BY os.segment_index
             ORDER BY os.segment_index ASC",
        )?;
        let rows = stmt
            .query_map(params![clip_id], |r| {
                Ok((r.get::<_, i64>(0)?, r.get::<_, i32>(1)?, r.get::<_, i64>(2)?))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    /// Most-recent-first list of attempts against a given segment, joined
    /// through the session table. Used by the score-history UI under the
    /// ScoreCard.
    pub fn list_attempts_for_segment(
        &self,
        segment_id: i64,
        limit: i64,
    ) -> Result<Vec<AttemptRow>> {
        let mut stmt = self.conn.prepare(
            "SELECT a.id, a.session_id, a.attempt_audio_path, a.asr_transcript,
                    a.score_overall, a.score_word_accuracy, a.score_cadence,
                    a.score_pitch_corr, a.recorded_at
             FROM attempt a
             JOIN session s ON s.id = a.session_id
             WHERE s.segment_id = ?1
             ORDER BY a.recorded_at DESC
             LIMIT ?2",
        )?;
        let rows = stmt
            .query_map(params![segment_id, limit], |r| {
                let recorded_at_str: String = r.get(8)?;
                Ok(AttemptRow {
                    id: r.get(0)?,
                    session_id: r.get(1)?,
                    attempt_audio_path: r.get(2)?,
                    asr_transcript: r.get(3)?,
                    score_overall: r.get(4)?,
                    score_word_accuracy: r.get(5)?,
                    score_cadence: r.get(6)?,
                    score_pitch_corr: r.get(7)?,
                    recorded_at: chrono::DateTime::parse_from_rfc3339(&recorded_at_str)
                        .map(|dt| dt.with_timezone(&Utc))
                        .unwrap_or_else(|_| Utc::now()),
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    pub fn list_segments(&self, clip_id: i64) -> Result<Vec<SegmentRow>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, clip_id, start_ms, end_ms, text FROM segment
             WHERE clip_id = ?1 ORDER BY start_ms ASC",
        )?;
        let rows = stmt
            .query_map(params![clip_id], |r| {
                Ok(SegmentRow {
                    id: r.get(0)?,
                    clip_id: r.get(1)?,
                    start_ms: r.get(2)?,
                    end_ms: r.get(3)?,
                    text: r.get(4)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }
}

/// Map a SQLite row to a `CardRow`. Columns must be in this exact order:
/// id, segment_id, saved_at, due_at, stability, difficulty, reps, lapses,
/// state, last_review_at, cloze_word_indices.
fn row_to_card(r: &rusqlite::Row<'_>) -> rusqlite::Result<CardRow> {
    let saved_at_str: String = r.get(2)?;
    let due_at_str: String = r.get(3)?;
    let last_review_at_str: Option<String> = r.get(9)?;
    let cloze_json: String = r.get(10)?;
    let cloze: Vec<i64> = serde_json::from_str(&cloze_json).unwrap_or_default();
    Ok(CardRow {
        id: r.get(0)?,
        segment_id: r.get(1)?,
        saved_at: parse_rfc3339(&saved_at_str),
        due_at: parse_rfc3339(&due_at_str),
        stability: r.get(4)?,
        difficulty: r.get(5)?,
        reps: r.get(6)?,
        lapses: r.get(7)?,
        state: r.get(8)?,
        last_review_at: last_review_at_str.as_deref().map(parse_rfc3339),
        cloze_word_indices: cloze,
    })
}

fn parse_rfc3339(s: &str) -> chrono::DateTime<Utc> {
    chrono::DateTime::parse_from_rfc3339(s)
        .map(|dt| dt.with_timezone(&Utc))
        .unwrap_or_else(|_| Utc::now())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opens_in_memory_and_initializes_schema_version() {
        let db = Database::open_in_memory().expect("open");
        assert_eq!(
            db.schema_version().expect("version"),
            CURRENT_SCHEMA_VERSION,
        );
    }

    #[test]
    fn insert_and_read_clip_with_segments() {
        let db = Database::open_in_memory().expect("open");
        let clip_id = db
            .insert_clip("Test Talk", "https://example.com/a", "/tmp/a.wav", 9000, "[]")
            .expect("insert clip");
        db.insert_segment(clip_id, 0, 5000, "First sentence")
            .expect("insert seg 1");
        db.insert_segment(clip_id, 5000, 9000, "Second sentence")
            .expect("insert seg 2");

        let clips = db.list_clips().expect("list");
        assert_eq!(clips.len(), 1);
        assert_eq!(clips[0].title, "Test Talk");

        let segs = db.list_segments(clip_id).expect("list segs");
        assert_eq!(segs.len(), 2);
        assert_eq!(segs[0].text, "First sentence");
    }

    #[test]
    fn list_attempts_for_segment_returns_recent_first() {
        let db = Database::open_in_memory().expect("open");
        let clip_id = db
            .insert_clip("Talk", "https://example.com/x", "/tmp/x.wav", 9000, "[]")
            .expect("insert clip");
        db.insert_segment(clip_id, 0, 5000, "Hello").expect("seg");
        let segment_id = db.segment_id_for(clip_id, 0).expect("seg id");

        // Two attempts on the same segment, recorded back-to-back.
        let mk_score = |overall: i32| ScoreData {
            overall,
            word_accuracy: 1.0,
            cadence: 1.0,
            pitch_corr: Some(0.5),
            word_flags: vec![],
            user_transcript: format!("attempt {overall}"),
        };
        db.record_attempt(clip_id, 0, "/tmp/a1.wav", &mk_score(70))
            .expect("rec 1");
        std::thread::sleep(std::time::Duration::from_millis(1100));
        db.record_attempt(clip_id, 0, "/tmp/a2.wav", &mk_score(85))
            .expect("rec 2");

        let rows = db
            .list_attempts_for_segment(segment_id, 10)
            .expect("list attempts");
        assert_eq!(rows.len(), 2);
        // Most recent first.
        assert_eq!(rows[0].score_overall, 85);
        assert_eq!(rows[1].score_overall, 70);
    }

    #[test]
    fn list_segment_best_scores_returns_max_per_segment() {
        let db = Database::open_in_memory().expect("open");
        let clip_id = db
            .insert_clip("Talk", "https://example.com/z", "/tmp/z.wav", 9000, "[]")
            .expect("clip");
        db.insert_segment(clip_id, 0, 5000, "First").expect("s1");
        db.insert_segment(clip_id, 5000, 9000, "Second").expect("s2");

        let mk = |overall: i32| ScoreData {
            overall,
            word_accuracy: 1.0,
            cadence: 1.0,
            pitch_corr: Some(0.5),
            word_flags: vec![],
            user_transcript: "x".into(),
        };

        // Segment 0: two attempts (70, 85). Segment 1: no attempts.
        db.record_attempt(clip_id, 0, "/tmp/a1.wav", &mk(70))
            .expect("a1");
        db.record_attempt(clip_id, 0, "/tmp/a2.wav", &mk(85))
            .expect("a2");

        let rows = db
            .list_segment_best_scores(clip_id)
            .expect("best scores");
        assert_eq!(rows.len(), 1, "only segments with attempts are returned");
        let (idx, best, count) = rows[0];
        assert_eq!(idx, 0);
        assert_eq!(best, 85);
        assert_eq!(count, 2);
    }

    #[test]
    fn save_card_is_idempotent_and_persists_state_through_review() {
        let db = Database::open_in_memory().expect("open");
        let clip_id = db
            .insert_clip("Talk", "https://example.com/c", "/tmp/c.wav", 9000, "[]")
            .expect("clip");
        db.insert_segment(clip_id, 0, 5000, "Hi").expect("seg");
        let segment_id = db.segment_id_for(clip_id, 0).expect("seg id");

        // First save creates a new card.
        let c1 = db.save_card(segment_id).expect("save 1");
        assert_eq!(c1.segment_id, segment_id);
        assert_eq!(c1.state, "new");
        assert_eq!(c1.reps, 0);

        // Re-saving must NOT reset the FSRS state — the user can't lose
        // progress by accidentally clicking the star twice.
        db.record_review(c1.id, "2099-01-01T00:00:00+00:00", 5.0, 4.0, 1, 0, "review")
            .expect("review");
        let c2 = db.save_card(segment_id).expect("save 2");
        assert_eq!(c2.id, c1.id, "same card row");
        assert_eq!(c2.reps, 1, "reps preserved across re-save");
        assert_eq!(c2.state, "review");

        // Saved-segment listing.
        let saved = db.list_saved_segments(clip_id).expect("list saved");
        assert_eq!(saved, vec![segment_id]);

        // Unsave deletes.
        db.unsave_card(segment_id).expect("unsave");
        let saved_after = db.list_saved_segments(clip_id).expect("list after");
        assert!(saved_after.is_empty());
    }

    #[test]
    fn set_card_cloze_round_trips_through_get() {
        let db = Database::open_in_memory().expect("open");
        let clip_id = db
            .insert_clip("Talk", "https://example.com/cloze", "/tmp/cloze.wav", 9000, "[]")
            .expect("clip");
        db.insert_segment(clip_id, 0, 5000, "Let's touch base tomorrow")
            .expect("seg");
        let segment_id = db.segment_id_for(clip_id, 0).expect("seg id");
        db.save_card(segment_id).expect("save");

        // Blank "touch" (idx=1) and "base" (idx=2). Order preserved.
        db.set_card_cloze(segment_id, &[1, 2]).expect("set cloze");

        let card = db
            .get_card_for_segment(segment_id)
            .expect("get")
            .expect("present");
        assert_eq!(card.cloze_word_indices, vec![1, 2]);

        // Clearing.
        db.set_card_cloze(segment_id, &[]).expect("clear");
        let card = db
            .get_card_for_segment(segment_id)
            .expect("get")
            .expect("present");
        assert!(card.cloze_word_indices.is_empty());
    }

    #[test]
    fn delete_clip_cascades_to_segments_sessions_attempts() {
        let db = Database::open_in_memory().expect("open");
        let clip_id = db
            .insert_clip("Talk", "https://example.com/y", "/tmp/y.wav", 9000, "[]")
            .expect("insert clip");
        db.insert_segment(clip_id, 0, 5000, "Hi").expect("seg");
        let score = ScoreData {
            overall: 70,
            word_accuracy: 1.0,
            cadence: 1.0,
            pitch_corr: Some(0.5),
            word_flags: vec![],
            user_transcript: "hi".into(),
        };
        db.record_attempt(clip_id, 0, "/tmp/y_attempt.wav", &score)
            .expect("attempt");

        let returned = db.delete_clip(clip_id).expect("delete");
        assert_eq!(returned.as_deref(), Some("/tmp/y.wav"));

        // Cascades: segment / session / attempt should all be gone.
        let count: i64 = db
            .conn
            .query_row("SELECT COUNT(*) FROM segment", [], |r| r.get(0))
            .expect("count segs");
        assert_eq!(count, 0);
        let count: i64 = db
            .conn
            .query_row("SELECT COUNT(*) FROM session", [], |r| r.get(0))
            .expect("count sess");
        assert_eq!(count, 0);
        let count: i64 = db
            .conn
            .query_row("SELECT COUNT(*) FROM attempt", [], |r| r.get(0))
            .expect("count att");
        assert_eq!(count, 0);

        // Idempotent: deleting a missing clip returns None, not an error.
        assert!(db.delete_clip(clip_id).expect("delete missing").is_none());
    }

    #[test]
    fn migration_is_idempotent() {
        // Re-running open() on the same path must not error or duplicate rows.
        let tmp = tempfile::NamedTempFile::new().expect("tmp");
        {
            let db = Database::open(tmp.path()).expect("open 1");
            assert_eq!(
                db.schema_version().expect("version"),
                CURRENT_SCHEMA_VERSION,
            );
        }
        {
            let db = Database::open(tmp.path()).expect("open 2");
            assert_eq!(
                db.schema_version().expect("version"),
                CURRENT_SCHEMA_VERSION,
            );
        }
    }
}
