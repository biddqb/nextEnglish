//! Data models. Mirrors `sidecar/sidecar/pipeline/models.py`.
//!
//! Per eng review C1: the integration test asserts a real Python response
//! deserializes into these Rust types. If types drift, that test breaks.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WordTimestamp {
    pub word: String,
    pub start: f64,
    pub end: f64,
    #[serde(default = "default_score")]
    pub score: f64,
}

fn default_score() -> f64 { 1.0 }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Segment {
    pub start_ms: i64,
    pub end_ms: i64,
    pub text: String,
    #[serde(default)]
    pub words: Vec<WordTimestamp>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Clip {
    pub title: String,
    pub source_uri: String,
    pub audio_path: String,
    pub duration_ms: i64,
    pub segments: Vec<Segment>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WordFlag {
    pub word: String,
    pub matched: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScoreData {
    pub overall: i32,
    pub word_accuracy: f64,
    pub cadence: f64,
    pub pitch_corr: Option<f64>,
    pub word_flags: Vec<WordFlag>,
    pub user_transcript: String,
}

/// Voice module: transcript + duration of a standalone recording. No
/// scoring against a reference — the frontend does its own per-sub-mode
/// analysis on the returned segments (filler counts, WPM, etc.).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VoiceTranscribeData {
    pub segments: Vec<Segment>,
    pub duration_ms: i64,
}

/// Speak module: synthesized prompt audio. The audio_path is absolute
/// (sidecar-relative paths are resolved before the command returns) so
/// the frontend can pass it directly to `tauriFileUrl()` for playback.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpeakTtsData {
    pub audio_path: String,
    pub duration_ms: i64,
}

/// Speak module: one prior turn in a go-deeper conversation. The current
/// turn (the one being judged) travels separately as `user_transcript`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpeakHistoryTurn {
    pub role: String, // "user" | "assistant"
    pub content: String,
}

/// Speak module: structured critique returned from /speak/judge.
/// `score_overall` is 0-100; `strengths` and `improvements` are 0-3 short
/// items each; `follow_up_question` is empty when the model didn't
/// suggest one (single-turn flow with go-deeper disabled).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpeakCritique {
    pub score_overall: i64,
    pub feedback: String,
    pub strengths: Vec<String>,
    pub improvements: Vec<String>,
    pub follow_up_question: String,
}

/// Speak module: one curated scenario. `id` is stable across builds so
/// the frontend can persist a most-recent list later.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpeakScenario {
    pub id: String,
    pub category: String,
    pub title: String,
    pub prompt: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClipRow {
    pub id: i64,
    pub title: String,
    pub source_uri: String,
    pub audio_path: String,
    pub duration_ms: i64,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SegmentRow {
    pub id: i64,
    pub clip_id: i64,
    pub start_ms: i64,
    pub end_ms: i64,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionRow {
    pub id: i64,
    pub segment_id: i64,
    pub started_at: DateTime<Utc>,
    pub ended_at: Option<DateTime<Utc>>,
}

/// Saved-segment SRS card. One row per segment that the user has marked
/// for spaced-repetition review. State mirrors what `ts-fsrs` expects: the
/// scheduler runs in TypeScript, this row is just persistence.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CardRow {
    pub id: i64,
    pub segment_id: i64,
    pub saved_at: DateTime<Utc>,
    pub due_at: DateTime<Utc>,
    pub stability: f64,
    pub difficulty: f64,
    pub reps: i64,
    pub lapses: i64,
    pub state: String,
    pub last_review_at: Option<DateTime<Utc>>,
    /// 0-based whitespace-split token positions blanked during review.
    /// Empty = regular review (no cloze).
    pub cloze_word_indices: Vec<i64>,
}

/// A card joined with the segment + clip context the review UI needs to
/// shadow-replay it. `clip_audio_path` is resolved-absolute by the command
/// layer.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DueCard {
    pub card: CardRow,
    pub clip_id: i64,
    pub clip_title: String,
    pub clip_audio_path: String,
    pub segment_index: i64,
    pub segment_text: String,
    pub segment_start_ms: i64,
    pub segment_end_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AttemptRow {
    pub id: i64,
    pub session_id: i64,
    pub attempt_audio_path: String,
    pub asr_transcript: String,
    pub score_overall: i32,
    pub score_word_accuracy: f64,
    pub score_cadence: f64,
    pub score_pitch_corr: Option<f64>,
    pub recorded_at: DateTime<Utc>,
}
