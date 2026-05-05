//! Rust core for nextEnglish v1: SQLite, Python sidecar lifecycle, IPC,
//! and the Tauri 2 shell entry point.
//!
//! The Tauri shell lives in `run()` (called from `main.rs`). The plain Rust
//! core (Database, Sidecar, models, etc.) is also exposed for the standalone
//! CLI binary at `src/bin/cli.rs`.

pub mod commands;
pub mod db;
pub mod error;
pub mod log;
pub mod models;
pub mod sidecar;

use std::path::PathBuf;
use std::sync::Arc;

use tokio::sync::Mutex;
use tracing::{error, info};

pub use db::Database;
pub use error::{Error, ErrorCode, ErrorEnvelope, Result};
pub use models::{
    AttemptRow, Clip, ClipRow, ScoreData, Segment, SegmentRow, SessionRow,
    WordFlag, WordTimestamp,
};
pub use sidecar::{Sidecar, SidecarConfig, SidecarHandle};

use commands::AppState;

/// Tauri shell entry. Spawns the Python sidecar, opens the SQLite database,
/// then hands control to `tauri::Builder`. Sidecar is killed on app exit
/// via `kill_on_drop` (eng A2).
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("tokio runtime");

    let sidecar_root = sidecar_root_for_dev();

    let (sidecar, db) = runtime.block_on(async {
        let cfg = SidecarConfig::dev_at(sidecar_root.clone());
        let sidecar = match Sidecar::spawn(cfg).await {
            Ok(s) => Arc::new(s),
            Err(e) => {
                error!(?e, "failed to spawn sidecar");
                std::process::exit(1);
            }
        };
        info!(port = sidecar.port(), pid = ?sidecar.pid(), "sidecar ready");

        // Open the SQLite database. Phase 3b uses a project-local path for
        // dev-friendliness; v1.1 will resolve via Tauri's app_data_dir.
        let db_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .map(|p| p.join("_work").join("nextenglish.db"))
            .unwrap_or_else(|| PathBuf::from("nextenglish.db"));
        std::fs::create_dir_all(db_path.parent().unwrap_or(&PathBuf::from("."))).ok();
        let db = Database::open(&db_path).expect("open db");
        info!(?db_path, "database open");

        (sidecar, Arc::new(Mutex::new(db)))
    });

    let state = AppState { sidecar, db, sidecar_root };

    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            commands::health,
            commands::ingest_url,
            commands::ingest_file,
            commands::probe_url,
            commands::ingest_url_trimmed,
            commands::list_clips,
            commands::list_segments,
            commands::get_clip,
            commands::save_attempt,
            commands::score_attempt,
            commands::list_attempts,
            commands::list_segment_best_scores,
            commands::delete_clip,
            commands::pitch_contour,
            commands::list_settings,
            commands::set_setting,
            commands::cache_stats,
            commands::clear_all_clips,
            commands::save_card,
            commands::unsave_card,
            commands::list_saved_segments,
            commands::count_due_cards,
            commands::list_due_cards,
            commands::record_review,
            commands::set_card_cloze,
            commands::get_card,
            commands::capture_chunk,
            commands::simulate_copy_keystroke,
            commands::export_to_obsidian,
            commands::transcribe_voice_audio,
            commands::speak_tts,
            commands::speak_judge,
            commands::speak_scenarios,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn sidecar_root_for_dev() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(|p| p.join("sidecar"))
        .unwrap_or_else(|| PathBuf::from("../sidecar"))
}
