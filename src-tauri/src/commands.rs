//! Tauri command handlers — bridge between the frontend and the Rust core.
//!
//! Each `#[tauri::command]` accepts/returns serde-friendly types and converts
//! errors to a `CmdError` envelope visible from JS via `invoke().catch(...)`.
//!
//! Phase 3b adds: `get_clip`, `save_attempt`, `score_attempt` to support
//! the practice loop in addition to the Phase 3a smoke commands.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD as B64;
use serde::Serialize;
use tauri::State;
use tokio::fs;
use tokio::process::Command;
use tokio::sync::Mutex;
use tracing::{error, info};

use crate::error::ErrorEnvelope;
use crate::models::{
    AttemptRow, CardRow, Clip, ClipRow, DueCard, ScoreData, Segment, SegmentRow,
    VoiceTranscribeData,
};
use crate::sidecar::{PitchContoursResponse, ProbeResult, Sidecar};
use crate::Database;

pub struct AppState {
    pub sidecar: Arc<Sidecar>,
    pub db: Arc<Mutex<Database>>,
    /// Used to resolve relative paths that the Python sidecar stored in the
    /// DB (audio_path is `./_work/clips/<hash>/audio.wav` relative to the
    /// sidecar's cwd).
    pub sidecar_root: PathBuf,
}

impl AppState {
    fn resolve(&self, rel_or_abs: &str) -> PathBuf {
        let p = PathBuf::from(rel_or_abs);
        if p.is_absolute() { p } else { self.sidecar_root.join(p) }
    }
}

#[derive(Debug, Serialize)]
pub struct CmdError {
    pub code: String,
    pub message: String,
    pub retryable: bool,
}

impl From<crate::error::Error> for CmdError {
    fn from(e: crate::error::Error) -> Self {
        match e {
            crate::error::Error::Api(env) => Self::from(env),
            crate::error::Error::SidecarUnreachable(m) => Self {
                code: "SIDECAR_UNREACHABLE".into(),
                message: m,
                retryable: true,
            },
            crate::error::Error::Database(e) => Self {
                code: "DATABASE_ERROR".into(),
                message: e.to_string(),
                retryable: false,
            },
            other => Self {
                code: "INTERNAL".into(),
                message: other.to_string(),
                retryable: false,
            },
        }
    }
}

impl From<ErrorEnvelope> for CmdError {
    fn from(env: ErrorEnvelope) -> Self {
        Self {
            code: format!("{:?}", env.code).to_uppercase(),
            message: env.message,
            retryable: env.retryable,
        }
    }
}

fn cmd_err(code: &str, message: impl Into<String>) -> CmdError {
    CmdError { code: code.to_string(), message: message.into(), retryable: false }
}

#[tauri::command]
pub async fn health(state: State<'_, AppState>) -> Result<String, CmdError> {
    state.sidecar.health().await.map_err(CmdError::from)?;
    Ok(format!("ok :{}", state.sidecar.port()))
}

#[tauri::command]
pub async fn ingest_url(
    state: State<'_, AppState>,
    url: String,
    max_duration_s: Option<i32>,
    model_name: Option<String>,
) -> Result<Clip, CmdError> {
    let max = max_duration_s.unwrap_or(900);
    let mut clip = state
        .sidecar
        .ingest_url(&url, max, model_name.as_deref())
        .await?;

    // Resolve the audio_path returned by the Python sidecar to an absolute
    // path before persisting, so the frontend's <audio> tag and the Rust
    // score-attempt slicer don't have to know about sidecar's cwd.
    clip.audio_path = state
        .resolve(&clip.audio_path)
        .to_string_lossy()
        .into_owned();

    let transcript_json = serde_json::to_string(&clip.segments)
        .map_err(|e| cmd_err("INTERNAL", e.to_string()))?;

    let db = state.db.lock().await;
    let clip_id = db.insert_clip(
        &clip.title,
        &clip.source_uri,
        &clip.audio_path,
        clip.duration_ms,
        &transcript_json,
    ).map_err(|e| {
        error!(?e, "insert_clip failed");
        CmdError::from(e)
    })?;
    for seg in &clip.segments {
        db.insert_segment(clip_id, seg.start_ms, seg.end_ms, &seg.text)
            .map_err(CmdError::from)?;
    }
    Ok(clip)
}

#[derive(Debug, Serialize)]
pub struct CapturedChunk {
    pub clip_id: i64,
    pub segment_index: i64,
    pub text: String,
    pub audio_path: String,
}

/// Fire a Ctrl+C keystroke at whatever app currently has OS focus, so the
/// user's *selected* text lands in the clipboard before the JS layer reads
/// it. This removes the "press Ctrl+C, THEN press the capture hotkey" two-
/// step dance — the capture hotkey now does both.
///
/// Best-effort: if the focused app doesn't respond to Ctrl+C, the clipboard
/// won't change and the JS layer falls back to whatever is already in the
/// clipboard. We use enigo's cross-platform keystroke simulation; on
/// Windows this routes through SendInput.
#[tauri::command]
pub async fn simulate_copy_keystroke() -> Result<(), CmdError> {
    use enigo::{Direction, Enigo, Key, Keyboard, Settings};
    let mut enigo = Enigo::new(&Settings::default())
        .map_err(|e| cmd_err("INTERNAL", format!("enigo init: {e}")))?;
    enigo
        .key(Key::Control, Direction::Press)
        .map_err(|e| cmd_err("INTERNAL", format!("press Ctrl: {e}")))?;
    enigo
        .key(Key::Unicode('c'), Direction::Click)
        .map_err(|e| cmd_err("INTERNAL", format!("click C: {e}")))?;
    enigo
        .key(Key::Control, Direction::Release)
        .map_err(|e| cmd_err("INTERNAL", format!("release Ctrl: {e}")))?;
    Ok(())
}

/// Capture-to-Obsidian entry point: take a free-text chunk (typically from
/// the user's clipboard via the Ctrl+Shift+C global hotkey), render it
/// through the sidecar's gTTS, persist as a synthetic single-segment clip
/// (so the existing shadowing loop just works), and auto-save the segment
/// as an SRS card.
///
/// The synthetic clip's `source_uri` is `capture://<sha12>` so the sidebar
/// can visually distinguish captures from real ingests. Re-capturing the
/// same text returns the existing clip (idempotent on hash).
#[tauri::command]
pub async fn capture_chunk(
    state: State<'_, AppState>,
    text: String,
) -> Result<CapturedChunk, CmdError> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Err(cmd_err("INTERNAL", "empty capture text"));
    }
    if trimmed.len() > 2000 {
        return Err(cmd_err("INTERNAL", "capture text exceeds 2000 chars"));
    }

    // Hash determines BOTH the on-disk cache directory AND the clip's
    // source_uri, so the same text re-captured idempotently lands on the
    // same row.
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(b"capture::");
    hasher.update(trimmed.as_bytes());
    let hash_hex = format!("{:x}", hasher.finalize());
    let short_hash: String = hash_hex.chars().take(12).collect();
    let source_uri = format!("capture://{short_hash}");

    // Idempotency: if a clip with this source_uri already exists, return it
    // straight up without spinning the sidecar.
    {
        let db = state.db.lock().await;
        if let Some(existing) = db
            .find_clip_by_source(&source_uri)
            .map_err(CmdError::from)?
        {
            return Ok(CapturedChunk {
                clip_id: existing.id,
                segment_index: 0,
                text: trimmed.to_string(),
                audio_path: state
                    .resolve(&existing.audio_path)
                    .to_string_lossy()
                    .into_owned(),
            });
        }
    }

    // Render audio via the sidecar.
    let tts = state.sidecar.tts(trimmed, "en").await?;
    let abs_audio = state.resolve(&tts.audio_path);

    // Persist a synthetic clip with one segment that IS the chunk.
    let title = chunk_title(trimmed);
    let segment = Segment {
        start_ms: 0,
        end_ms: tts.duration_ms,
        text: trimmed.to_string(),
        words: vec![],
    };
    let transcript_json = serde_json::to_string(&vec![segment.clone()])
        .map_err(|e| cmd_err("INTERNAL", e.to_string()))?;

    let db = state.db.lock().await;
    let clip_id = db
        .insert_clip(
            &title,
            &source_uri,
            &abs_audio.to_string_lossy(),
            tts.duration_ms,
            &transcript_json,
        )
        .map_err(CmdError::from)?;
    db.insert_segment(clip_id, segment.start_ms, segment.end_ms, &segment.text)
        .map_err(CmdError::from)?;

    // Auto-save: capturing implies "I want to review this." Get the segment
    // id (always 0-th of this clip) and create the card row.
    let segment_id = db.segment_id_for(clip_id, 0).map_err(CmdError::from)?;
    db.save_card(segment_id).map_err(CmdError::from)?;

    Ok(CapturedChunk {
        clip_id,
        segment_index: 0,
        text: trimmed.to_string(),
        audio_path: abs_audio.to_string_lossy().into_owned(),
    })
}

fn chunk_title(text: &str) -> String {
    // First six words or 60 chars, whichever is shorter. Used as the clip
    // row's title, which is what the sidebar shows.
    let words: Vec<&str> = text.split_whitespace().take(6).collect();
    let candidate = words.join(" ");
    if candidate.chars().count() <= 60 {
        candidate
    } else {
        let truncated: String = candidate.chars().take(60).collect();
        format!("{truncated}…")
    }
}

/// Lightweight probe of a URL — duration + title — used by the trim dialog.
#[tauri::command]
pub async fn probe_url(
    state: State<'_, AppState>,
    url: String,
) -> Result<ProbeResult, CmdError> {
    state.sidecar.probe_url(&url).await.map_err(CmdError::from)
}

/// Ingest only a [trim_start_s, trim_end_s] window of a URL. Same persist /
/// return shape as `ingest_url`.
#[tauri::command]
pub async fn ingest_url_trimmed(
    state: State<'_, AppState>,
    url: String,
    trim_start_s: f64,
    trim_end_s: f64,
    max_duration_s: Option<i32>,
    model_name: Option<String>,
) -> Result<Clip, CmdError> {
    let max = max_duration_s.unwrap_or(900);
    let mut clip = state
        .sidecar
        .ingest_url_trimmed(&url, max, trim_start_s, trim_end_s, model_name.as_deref())
        .await?;

    clip.audio_path = state
        .resolve(&clip.audio_path)
        .to_string_lossy()
        .into_owned();

    let transcript_json = serde_json::to_string(&clip.segments)
        .map_err(|e| cmd_err("INTERNAL", e.to_string()))?;

    let db = state.db.lock().await;
    let clip_id = db
        .insert_clip(
            &clip.title,
            &clip.source_uri,
            &clip.audio_path,
            clip.duration_ms,
            &transcript_json,
        )
        .map_err(|e| {
            error!(?e, "insert_clip failed (trimmed)");
            CmdError::from(e)
        })?;
    for seg in &clip.segments {
        db.insert_segment(clip_id, seg.start_ms, seg.end_ms, &seg.text)
            .map_err(CmdError::from)?;
    }
    Ok(clip)
}

/// Ingest a local audio/video file (drag-and-dropped or picked from disk).
/// Same persistence/return shape as `ingest_url` so the UI can treat the two
/// equivalently. The Python sidecar's `kind="file"` path handles ffmpeg
/// normalize + duration cap; we just persist the result.
#[tauri::command]
pub async fn ingest_file(
    state: State<'_, AppState>,
    file_path: String,
    max_duration_s: Option<i32>,
    model_name: Option<String>,
) -> Result<Clip, CmdError> {
    let max = max_duration_s.unwrap_or(900);
    let mut clip = state
        .sidecar
        .ingest_file(&file_path, max, model_name.as_deref())
        .await?;

    clip.audio_path = state
        .resolve(&clip.audio_path)
        .to_string_lossy()
        .into_owned();

    let transcript_json = serde_json::to_string(&clip.segments)
        .map_err(|e| cmd_err("INTERNAL", e.to_string()))?;

    let db = state.db.lock().await;
    let clip_id = db
        .insert_clip(
            &clip.title,
            &clip.source_uri,
            &clip.audio_path,
            clip.duration_ms,
            &transcript_json,
        )
        .map_err(|e| {
            error!(?e, "insert_clip failed");
            CmdError::from(e)
        })?;
    for seg in &clip.segments {
        db.insert_segment(clip_id, seg.start_ms, seg.end_ms, &seg.text)
            .map_err(CmdError::from)?;
    }
    Ok(clip)
}

#[tauri::command]
pub async fn list_clips(state: State<'_, AppState>) -> Result<Vec<ClipRow>, CmdError> {
    let mut rows = state.db.lock().await.list_clips().map_err(CmdError::from)?;
    // Resolve any pre-Phase-3b relative paths to absolute, so the frontend
    // can pass them to the Tauri asset protocol unconditionally.
    for r in &mut rows {
        r.audio_path = state.resolve(&r.audio_path).to_string_lossy().into_owned();
    }
    Ok(rows)
}

#[tauri::command]
pub async fn list_segments(
    state: State<'_, AppState>,
    clip_id: i64,
) -> Result<Vec<SegmentRow>, CmdError> {
    state.db.lock().await.list_segments(clip_id).map_err(CmdError::from)
}

#[derive(Debug, Serialize)]
pub struct ClipPayload {
    pub clip: ClipRow,
    pub segments: Vec<FullSegment>,
}

#[derive(Debug, Serialize)]
pub struct FullSegment {
    pub id: i64,
    pub clip_id: i64,
    pub start_ms: i64,
    pub end_ms: i64,
    pub text: String,
    pub words: Vec<crate::models::WordTimestamp>,
}

/// Hydrate a clip with its segments + word-level timestamps. Combines the
/// SQLite segment-table rows (for IDs) with the transcript_json (for words).
#[tauri::command]
pub async fn get_clip(
    state: State<'_, AppState>,
    clip_id: i64,
) -> Result<ClipPayload, CmdError> {
    let db = state.db.lock().await;
    let (mut clip, transcript_json) = db
        .get_clip_with_transcript(clip_id)
        .map_err(CmdError::from)?
        .ok_or_else(|| cmd_err("INTERNAL", format!("clip {clip_id} not found")))?;
    let segment_rows = db.list_segments(clip_id).map_err(CmdError::from)?;
    drop(db);

    clip.audio_path = state.resolve(&clip.audio_path).to_string_lossy().into_owned();

    let transcript: Vec<Segment> = serde_json::from_str(&transcript_json)
        .map_err(|e| cmd_err("INTERNAL", format!("transcript_json decode: {e}")))?;

    if segment_rows.len() != transcript.len() {
        return Err(cmd_err(
            "INTERNAL",
            format!(
                "segment count mismatch: db={}, transcript={}",
                segment_rows.len(), transcript.len(),
            ),
        ));
    }

    let segments: Vec<FullSegment> = segment_rows
        .into_iter()
        .zip(transcript.into_iter())
        .map(|(row, t)| FullSegment {
            id: row.id,
            clip_id: row.clip_id,
            start_ms: row.start_ms,
            end_ms: row.end_ms,
            text: t.text,
            words: t.words,
        })
        .collect();

    Ok(ClipPayload { clip, segments })
}

/// Persist a user-recorded audio attempt to disk. Receives the audio as
/// base64 (the frontend's MediaRecorder blob; webm/opus or m4a). Returns the
/// absolute path of the written file, ready to pass to `score_attempt`.
///
/// Storage layout: `<clip_audio_dir>/attempts/<segment_index>_<ts>.<ext>`.
#[tauri::command]
pub async fn save_attempt(
    state: State<'_, AppState>,
    clip_id: i64,
    segment_index: i64,
    audio_base64: String,
    extension: String,
) -> Result<String, CmdError> {
    let bytes = B64
        .decode(audio_base64.as_bytes())
        .map_err(|e| cmd_err("INTERNAL", format!("base64 decode: {e}")))?;

    let db = state.db.lock().await;
    let (clip_row, _) = db
        .get_clip_with_transcript(clip_id)
        .map_err(CmdError::from)?
        .ok_or_else(|| cmd_err("INTERNAL", format!("clip {clip_id} not found")))?;
    drop(db);

    let audio_path = state.resolve(&clip_row.audio_path);
    let clip_dir = audio_path
        .parent()
        .ok_or_else(|| cmd_err("INTERNAL", "clip audio path has no parent"))?;
    let attempts_dir = clip_dir.join("attempts");
    fs::create_dir_all(&attempts_dir).await.map_err(|e| {
        cmd_err("INTERNAL", format!("create attempts dir: {e}"))
    })?;

    let ts = chrono::Utc::now().format("%Y%m%dT%H%M%S");
    let safe_ext = extension.chars().filter(|c| c.is_alphanumeric()).collect::<String>();
    let filename = format!("{segment_index}_{ts}.{safe_ext}");
    let out_path = attempts_dir.join(&filename);

    fs::write(&out_path, &bytes).await.map_err(|e| {
        cmd_err("INTERNAL", format!("write attempt: {e}"))
    })?;

    info!(?out_path, bytes = bytes.len(), "attempt saved");
    Ok(out_path.to_string_lossy().into_owned())
}

/// Slice the reference clip to just the requested segment, then call the
/// sidecar's /score endpoint with the slice + the user's attempt audio.
/// Persists the result as a session+attempt row in SQLite.
#[tauri::command]
pub async fn score_attempt(
    state: State<'_, AppState>,
    clip_id: i64,
    segment_index: i64,
    attempt_audio_path: String,
) -> Result<ScoreData, CmdError> {
    let db = state.db.lock().await;
    let (clip_row, transcript_json) = db
        .get_clip_with_transcript(clip_id)
        .map_err(CmdError::from)?
        .ok_or_else(|| cmd_err("INTERNAL", format!("clip {clip_id} not found")))?;
    drop(db);

    let transcript: Vec<Segment> = serde_json::from_str(&transcript_json)
        .map_err(|e| cmd_err("INTERNAL", format!("transcript_json decode: {e}")))?;
    let seg = transcript.get(segment_index as usize).ok_or_else(|| {
        cmd_err("INTERNAL", format!("segment_index {segment_index} out of range"))
    })?.clone();

    let clip_audio = state.resolve(&clip_row.audio_path);
    let clip_dir = clip_audio
        .parent()
        .ok_or_else(|| cmd_err("INTERNAL", "clip audio path has no parent"))?;
    let segments_dir = clip_dir.join("segments");
    fs::create_dir_all(&segments_dir).await.map_err(|e| {
        cmd_err("INTERNAL", format!("create segments dir: {e}"))
    })?;
    let seg_path = segments_dir.join(format!("{segment_index}.wav"));
    if !seg_path.is_file() {
        slice_audio(
            &clip_audio,
            &seg_path,
            seg.start_ms as f64 / 1000.0,
            seg.end_ms as f64 / 1000.0,
        ).await.map_err(|e| cmd_err("INTERNAL", e))?;
    }

    let score = state.sidecar.score(
        seg_path.to_string_lossy().as_ref(),
        &seg.text,
        &attempt_audio_path,
    ).await.map_err(CmdError::from)?;

    // Persist. Failure here doesn't prevent returning the score — the user
    // sees their score even if SQLite hiccupped, and the next attempt will
    // try again.
    let db = state.db.lock().await;
    if let Err(e) = db.record_attempt(clip_id, segment_index, &attempt_audio_path, &score) {
        error!(?e, clip_id, segment_index, "record_attempt failed; score returned anyway");
    }

    Ok(score)
}

#[derive(Debug, Serialize)]
pub struct SettingPair {
    pub key: String,
    pub value: String,
}

#[tauri::command]
pub async fn list_settings(
    state: State<'_, AppState>,
) -> Result<Vec<SettingPair>, CmdError> {
    let rows = state
        .db
        .lock()
        .await
        .list_settings()
        .map_err(CmdError::from)?;
    Ok(rows
        .into_iter()
        .map(|(key, value)| SettingPair { key, value })
        .collect())
}

#[tauri::command]
pub async fn set_setting(
    state: State<'_, AppState>,
    key: String,
    value: Option<String>,
) -> Result<(), CmdError> {
    state
        .db
        .lock()
        .await
        .set_setting(&key, value.as_deref())
        .map_err(CmdError::from)
}

#[derive(Debug, Serialize)]
pub struct CacheStats {
    /// Bytes consumed by the on-disk clip directory tree.
    pub bytes: u64,
    /// Number of top-level clip directories under _work/clips.
    pub clip_count: u64,
}

#[tauri::command]
pub async fn cache_stats(
    state: State<'_, AppState>,
) -> Result<CacheStats, CmdError> {
    let clips_root = state.sidecar_root.join("_work").join("clips");
    if !clips_root.is_dir() {
        return Ok(CacheStats { bytes: 0, clip_count: 0 });
    }
    let mut bytes: u64 = 0;
    let mut clip_count: u64 = 0;
    let mut top_iter = match fs::read_dir(&clips_root).await {
        Ok(d) => d,
        Err(_) => return Ok(CacheStats { bytes: 0, clip_count: 0 }),
    };
    while let Ok(Some(entry)) = top_iter.next_entry().await {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        clip_count += 1;
        bytes += dir_size_bytes(&path).await;
    }
    Ok(CacheStats { bytes, clip_count })
}

/// Delete every clip from the database and clear the on-disk clip cache.
/// Used by the Settings panel's "Delete all clips" action.
#[tauri::command]
pub async fn clear_all_clips(state: State<'_, AppState>) -> Result<(), CmdError> {
    let db = state.db.lock().await;
    // ON DELETE CASCADE handles segments / sessions / attempts.
    db.exec_raw("DELETE FROM clip").map_err(CmdError::from)?;
    drop(db);

    let clips_root = state.sidecar_root.join("_work").join("clips");
    if clips_root.is_dir() {
        if let Err(e) = fs::remove_dir_all(&clips_root).await {
            error!(?e, ?clips_root, "clear_all_clips: dir cleanup failed");
        }
        // Recreate the empty parent so subsequent ingests don't trip on a
        // missing directory.
        let _ = fs::create_dir_all(&clips_root).await;
    }
    Ok(())
}

async fn dir_size_bytes(dir: &Path) -> u64 {
    use std::collections::VecDeque;
    let mut queue: VecDeque<PathBuf> = VecDeque::new();
    queue.push_back(dir.to_path_buf());
    let mut total: u64 = 0;
    while let Some(p) = queue.pop_front() {
        let mut iter = match fs::read_dir(&p).await {
            Ok(i) => i,
            Err(_) => continue,
        };
        while let Ok(Some(entry)) = iter.next_entry().await {
            let path = entry.path();
            match entry.metadata().await {
                Ok(m) if m.is_dir() => queue.push_back(path),
                Ok(m) => total = total.saturating_add(m.len()),
                Err(_) => {}
            }
        }
    }
    total
}

/// Delete a clip and every segment/session/attempt that hangs off it (via
/// ON DELETE CASCADE), then remove the on-disk hash-keyed clip directory
/// (audio.wav + segments/ + attempts/). Disk cleanup is best-effort; if it
/// fails we still report success because the DB row is gone — the orphan
/// directory is harmless.
#[tauri::command]
pub async fn delete_clip(
    state: State<'_, AppState>,
    clip_id: i64,
) -> Result<(), CmdError> {
    let db = state.db.lock().await;
    let audio_path = db.delete_clip(clip_id).map_err(CmdError::from)?;
    drop(db);

    let Some(audio_path) = audio_path else {
        // No-op: nothing to delete on disk either.
        info!(clip_id, "delete_clip: row did not exist; nothing to clean up");
        return Ok(());
    };

    let resolved = state.resolve(&audio_path);
    if let Some(clip_dir) = resolved.parent() {
        if clip_dir.is_dir() {
            if let Err(e) = fs::remove_dir_all(clip_dir).await {
                error!(?e, ?clip_dir, "delete_clip: clip dir cleanup failed");
            } else {
                info!(?clip_dir, "delete_clip: clip dir removed");
            }
        }
    }
    Ok(())
}

/// Pitch contours (z-normalized f0) for both the reference segment and a
/// stored user attempt. Powers the visual A/B in the PitchOverlay details
/// panel. Slices the segment WAV on demand if its cache is missing.
#[tauri::command]
pub async fn pitch_contour(
    state: State<'_, AppState>,
    clip_id: i64,
    segment_index: i64,
    attempt_audio_path: String,
) -> Result<PitchContoursResponse, CmdError> {
    let db = state.db.lock().await;
    let (clip_row, transcript_json) = db
        .get_clip_with_transcript(clip_id)
        .map_err(CmdError::from)?
        .ok_or_else(|| cmd_err("INTERNAL", format!("clip {clip_id} not found")))?;
    drop(db);

    let transcript: Vec<Segment> = serde_json::from_str(&transcript_json)
        .map_err(|e| cmd_err("INTERNAL", format!("transcript_json decode: {e}")))?;
    let seg = transcript
        .get(segment_index as usize)
        .ok_or_else(|| {
            cmd_err(
                "INTERNAL",
                format!("segment_index {segment_index} out of range"),
            )
        })?
        .clone();

    let clip_audio = state.resolve(&clip_row.audio_path);
    let clip_dir = clip_audio
        .parent()
        .ok_or_else(|| cmd_err("INTERNAL", "clip audio path has no parent"))?;
    let segments_dir = clip_dir.join("segments");
    fs::create_dir_all(&segments_dir)
        .await
        .map_err(|e| cmd_err("INTERNAL", format!("create segments dir: {e}")))?;
    let seg_path = segments_dir.join(format!("{segment_index}.wav"));
    if !seg_path.is_file() {
        slice_audio(
            &clip_audio,
            &seg_path,
            seg.start_ms as f64 / 1000.0,
            seg.end_ms as f64 / 1000.0,
        )
        .await
        .map_err(|e| cmd_err("INTERNAL", e))?;
    }

    state
        .sidecar
        .pitch_contour(seg_path.to_string_lossy().as_ref(), &attempt_audio_path)
        .await
        .map_err(CmdError::from)
}

#[derive(Debug, Serialize)]
pub struct ExportResult {
    pub cards_exported: i64,
    pub audio_files_copied: i64,
    pub vault_path: String,
}

/// Markdown export to an Obsidian-compatible vault. Walks every saved card,
/// writes one `<vault>/nextEnglish/<slug>.md` file with FSRS state in
/// frontmatter, and copies referenced audio into `<vault>/nextEnglish/audio/`
/// so the vault is portable. One-way export — re-running overwrites; the
/// SQLite DB stays the source of truth (per-card edits in the markdown
/// file would be lost on next export, by design for v2 phase 1).
#[tauri::command]
pub async fn export_to_obsidian(
    state: State<'_, AppState>,
    vault_path: String,
) -> Result<ExportResult, CmdError> {
    let vault = PathBuf::from(vault_path.trim());
    if vault.as_os_str().is_empty() {
        return Err(cmd_err("INTERNAL", "vault path is empty"));
    }
    if !vault.is_dir() {
        return Err(cmd_err(
            "INTERNAL",
            format!("vault path is not a directory: {}", vault.display()),
        ));
    }

    let cards = state
        .db
        .lock()
        .await
        .list_all_cards_with_context()
        .map_err(CmdError::from)?;

    let nextenglish_dir = vault.join("nextEnglish");
    let audio_dir = nextenglish_dir.join("audio");
    fs::create_dir_all(&audio_dir).await.map_err(|e| {
        cmd_err("INTERNAL", format!("create vault subdir: {e}"))
    })?;

    let mut cards_written: i64 = 0;
    let mut audio_copied: i64 = 0;

    for card in &cards {
        let slug = slugify(&card.segment_text, card.card.id);
        let md_path = nextenglish_dir.join(format!("{slug}.md"));

        // Copy audio (best-effort — a missing source skips the copy but
        // still writes the markdown so the vault keeps an entry).
        let src_audio = state.resolve(&card.clip_audio_path);
        let dst_audio = audio_dir.join(format!("{slug}.wav"));
        if src_audio.is_file() {
            if let Err(e) = fs::copy(&src_audio, &dst_audio).await {
                error!(?e, ?src_audio, "audio copy failed");
            } else {
                audio_copied += 1;
            }
        }

        let md = render_card_markdown(card, &dst_audio);
        fs::write(&md_path, md).await.map_err(|e| {
            cmd_err("INTERNAL", format!("write {}: {}", md_path.display(), e))
        })?;
        cards_written += 1;
    }

    Ok(ExportResult {
        cards_exported: cards_written,
        audio_files_copied: audio_copied,
        vault_path: vault.to_string_lossy().into_owned(),
    })
}

fn slugify(text: &str, fallback_id: i64) -> String {
    let lower = text.to_lowercase();
    let cleaned: String = lower
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect();
    let trimmed: String = cleaned
        .split('-')
        .filter(|s| !s.is_empty())
        .take(8)
        .collect::<Vec<_>>()
        .join("-");
    if trimmed.is_empty() {
        format!("card-{fallback_id}")
    } else {
        format!("{trimmed}-{fallback_id}")
    }
}

fn render_card_markdown(card: &DueCard, audio_path: &Path) -> String {
    let audio_rel = audio_path
        .file_name()
        .map(|n| format!("audio/{}", n.to_string_lossy()))
        .unwrap_or_default();
    let cloze_yaml = if card.card.cloze_word_indices.is_empty() {
        "[]".to_string()
    } else {
        format!(
            "[{}]",
            card.card
                .cloze_word_indices
                .iter()
                .map(|i| i.to_string())
                .collect::<Vec<_>>()
                .join(", ")
        )
    };
    let source_kind = if card.clip_title.is_empty() {
        "clip"
    } else {
        // We can't tell capture from clip without the clip row's source_uri,
        // which list_all_cards_with_context doesn't currently fetch.
        // Frontmatter `source` stays generic; the body link below tells the
        // user which clip + segment it came from.
        "clip"
    };
    format!(
        r#"---
title: "{title}"
source: {source_kind}
clip: "{clip_title}"
segment_index: {segment_index}
saved_at: {saved_at}
due_at: {due_at}
state: {state}
reps: {reps}
lapses: {lapses}
stability: {stability}
difficulty: {difficulty}
cloze_word_indices: {cloze_yaml}
---

# {title}

> {segment_text}

[[{audio_rel}|Reference audio]]

- Clip: {clip_title}
- Segment: {segment_index_display}
- Range: {start_ms}–{end_ms} ms

*Exported from nextEnglish. Do not hand-edit — changes will be overwritten on the next export.*
"#,
        title = escape_yaml_string(&card.segment_text),
        clip_title = escape_yaml_string(&card.clip_title),
        segment_index = card.segment_index,
        segment_index_display = card.segment_index + 1,
        saved_at = card.card.saved_at.to_rfc3339(),
        due_at = card.card.due_at.to_rfc3339(),
        state = card.card.state,
        reps = card.card.reps,
        lapses = card.card.lapses,
        stability = card.card.stability,
        difficulty = card.card.difficulty,
        cloze_yaml = cloze_yaml,
        segment_text = card.segment_text,
        audio_rel = audio_rel,
        start_ms = card.segment_start_ms,
        end_ms = card.segment_end_ms,
    )
}

fn escape_yaml_string(s: &str) -> String {
    // YAML double-quoted scalar: backslash-escape backslashes and double quotes.
    s.replace('\\', "\\\\").replace('"', "\\\"")
}

/// Save a segment as an SRS card. Idempotent: returns the existing card if
/// already saved (no FSRS state reset).
#[tauri::command]
pub async fn save_card(
    state: State<'_, AppState>,
    clip_id: i64,
    segment_index: i64,
) -> Result<CardRow, CmdError> {
    let db = state.db.lock().await;
    let segment_id = db
        .segment_id_for(clip_id, segment_index)
        .map_err(CmdError::from)?;
    db.save_card(segment_id).map_err(CmdError::from)
}

#[tauri::command]
pub async fn unsave_card(
    state: State<'_, AppState>,
    clip_id: i64,
    segment_index: i64,
) -> Result<(), CmdError> {
    let db = state.db.lock().await;
    let segment_id = db
        .segment_id_for(clip_id, segment_index)
        .map_err(CmdError::from)?;
    db.unsave_card(segment_id).map_err(CmdError::from)
}

/// 0-based segment indices that have an SRS card on this clip. Used by
/// SegmentList to render the star icon next to saved rows.
#[tauri::command]
pub async fn list_saved_segments(
    state: State<'_, AppState>,
    clip_id: i64,
) -> Result<Vec<i64>, CmdError> {
    let db = state.db.lock().await;
    let segment_ids = db
        .list_saved_segments(clip_id)
        .map_err(CmdError::from)?;
    // Map segment_id (DB pk) to 0-based segment_index by re-fetching the
    // segment list. Cheap: a clip has tens of segments.
    let segments = db.list_segments(clip_id).map_err(CmdError::from)?;
    let saved: Vec<i64> = segments
        .iter()
        .enumerate()
        .filter_map(|(i, s)| {
            if segment_ids.contains(&s.id) {
                Some(i as i64)
            } else {
                None
            }
        })
        .collect();
    Ok(saved)
}

#[tauri::command]
pub async fn count_due_cards(
    state: State<'_, AppState>,
) -> Result<i64, CmdError> {
    state
        .db
        .lock()
        .await
        .count_due_cards()
        .map_err(CmdError::from)
}

/// Pull the next batch of due cards. Caller renders one at a time and walks
/// the list in order. We resolve the clip's audio_path to absolute so the
/// review UI can pass it straight to `<audio src=...>`.
#[tauri::command]
pub async fn list_due_cards(
    state: State<'_, AppState>,
    limit: Option<i64>,
) -> Result<Vec<DueCard>, CmdError> {
    let limit = limit.unwrap_or(50).clamp(1, 500);
    let mut rows = state
        .db
        .lock()
        .await
        .list_due_cards_with_context(limit)
        .map_err(CmdError::from)?;
    for r in &mut rows {
        r.clip_audio_path = state
            .resolve(&r.clip_audio_path)
            .to_string_lossy()
            .into_owned();
    }
    Ok(rows)
}

/// Replace the cloze word indices for a card. Indices are 0-based positions
/// in the segment's whitespace-split tokenization. Empty array = no cloze.
/// The card must already exist (segment must be saved first).
#[tauri::command]
pub async fn set_card_cloze(
    state: State<'_, AppState>,
    clip_id: i64,
    segment_index: i64,
    indices: Vec<i64>,
) -> Result<CardRow, CmdError> {
    let db = state.db.lock().await;
    let segment_id = db
        .segment_id_for(clip_id, segment_index)
        .map_err(CmdError::from)?;
    db.set_card_cloze(segment_id, &indices)
        .map_err(CmdError::from)?;
    db.get_card_for_segment(segment_id)
        .map_err(CmdError::from)?
        .ok_or_else(|| cmd_err("INTERNAL", "card disappeared after cloze update"))
}

/// Read a card by clip + segment index. Used to hydrate the cloze editor UI
/// in ShadowSession, which needs the existing cloze indices to render the
/// segment text in editor mode.
#[tauri::command]
pub async fn get_card(
    state: State<'_, AppState>,
    clip_id: i64,
    segment_index: i64,
) -> Result<Option<CardRow>, CmdError> {
    let db = state.db.lock().await;
    let segment_id = db
        .segment_id_for(clip_id, segment_index)
        .map_err(CmdError::from)?;
    db.get_card_for_segment(segment_id)
        .map_err(CmdError::from)
}

/// Persist the result of an FSRS review. The TypeScript layer (using
/// `ts-fsrs`) does the scheduling; this command just writes the new state
/// onto the card. `due_at` is RFC3339.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn record_review(
    state: State<'_, AppState>,
    card_id: i64,
    due_at: String,
    stability: f64,
    difficulty: f64,
    reps: i64,
    lapses: i64,
    card_state: String,
) -> Result<(), CmdError> {
    state
        .db
        .lock()
        .await
        .record_review(
            card_id,
            &due_at,
            stability,
            difficulty,
            reps,
            lapses,
            &card_state,
        )
        .map_err(CmdError::from)
}

#[derive(Debug, Serialize)]
pub struct SegmentBest {
    pub segment_index: i64,
    pub best_overall: i32,
    pub attempt_count: i64,
}

/// Best historical score per segment for a clip — used by the SegmentList to
/// render at-a-glance progress next to each row. Segments with no attempts
/// are omitted; the UI treats absence as "not attempted yet."
#[tauri::command]
pub async fn list_segment_best_scores(
    state: State<'_, AppState>,
    clip_id: i64,
) -> Result<Vec<SegmentBest>, CmdError> {
    let rows = state
        .db
        .lock()
        .await
        .list_segment_best_scores(clip_id)
        .map_err(CmdError::from)?;
    Ok(rows
        .into_iter()
        .map(|(segment_index, best_overall, attempt_count)| SegmentBest {
            segment_index,
            best_overall,
            attempt_count,
        })
        .collect())
}

/// Recent attempts for the given segment (resolved by clip_id + segment_index),
/// most recent first. Powers the score-history view under the ScoreCard.
/// Resolves any relative attempt_audio_path values to absolute so the webview
/// asset protocol can serve them directly.
#[tauri::command]
pub async fn list_attempts(
    state: State<'_, AppState>,
    clip_id: i64,
    segment_index: i64,
    limit: Option<i64>,
) -> Result<Vec<AttemptRow>, CmdError> {
    let limit = limit.unwrap_or(10).clamp(1, 100);
    let db = state.db.lock().await;
    let segment_id = db
        .segment_id_for(clip_id, segment_index)
        .map_err(CmdError::from)?;
    let mut rows = db
        .list_attempts_for_segment(segment_id, limit)
        .map_err(CmdError::from)?;
    drop(db);

    for r in &mut rows {
        r.attempt_audio_path = state
            .resolve(&r.attempt_audio_path)
            .to_string_lossy()
            .into_owned();
    }
    Ok(rows)
}

/// Voice module: persist a standalone recording to a temp-ish path and
/// transcribe it. Unlike `save_attempt` + `score_attempt`, this is a single
/// round-trip — there's no segment context, no DB persistence, no scoring.
/// The file lands under `<sidecar_root>/_work/voice/<ts>.<ext>` so the
/// sidecar (which uses the sidecar root as cwd) can find it.
///
/// Returns the transcript + duration; the frontend computes per-sub-mode
/// stats (filler counts, WPM, etc) from the segments.
#[tauri::command]
pub async fn transcribe_voice_audio(
    state: State<'_, AppState>,
    audio_base64: String,
    extension: String,
) -> Result<VoiceTranscribeData, CmdError> {
    let bytes = B64
        .decode(audio_base64.as_bytes())
        .map_err(|e| cmd_err("INTERNAL", format!("base64 decode: {e}")))?;

    let voice_dir = state.sidecar_root.join("_work").join("voice");
    fs::create_dir_all(&voice_dir).await.map_err(|e| {
        cmd_err("INTERNAL", format!("create voice dir: {e}"))
    })?;

    let ts = chrono::Utc::now().format("%Y%m%dT%H%M%S%3f");
    let safe_ext = extension
        .chars()
        .filter(|c| c.is_alphanumeric())
        .collect::<String>();
    let filename = format!("{ts}.{safe_ext}");
    let out_path = voice_dir.join(&filename);

    fs::write(&out_path, &bytes).await.map_err(|e| {
        cmd_err("INTERNAL", format!("write voice audio: {e}"))
    })?;

    info!(?out_path, bytes = bytes.len(), "voice audio saved");

    let result = state
        .sidecar
        .voice_transcribe(&out_path.to_string_lossy())
        .await
        .map_err(CmdError::from)?;

    Ok(result)
}

async fn slice_audio(
    input: &Path,
    output: &Path,
    start_s: f64,
    end_s: f64,
) -> Result<(), String> {
    let result = Command::new("ffmpeg")
        .args([
            "-y", "-loglevel", "error",
            "-i", input.to_string_lossy().as_ref(),
            "-ss", &format!("{start_s:.3}"),
            "-to", &format!("{end_s:.3}"),
            "-ar", "16000", "-ac", "1", "-acodec", "pcm_s16le",
            output.to_string_lossy().as_ref(),
        ])
        .output()
        .await
        .map_err(|e| format!("ffmpeg spawn failed: {e}"))?;

    if !result.status.success() {
        return Err(format!(
            "ffmpeg slice failed (exit {}): {}",
            result.status,
            String::from_utf8_lossy(&result.stderr).chars().take(300).collect::<String>(),
        ));
    }
    Ok(())
}
